import { NextRequest, NextResponse } from "next/server";
import { prepare } from "@/lib/sql";
import { addDealPayment } from "@/lib/db";

/**
 * Cron: ensures each production deal with min_monthly_amount > 0 has an
 * "expected" payment for the current month. Idempotent — skips if one exists.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const deals = await prepare<{
    id: string; min_monthly_amount: number; production_started_at: string | null;
  }>(`
    SELECT id, min_monthly_amount, production_started_at FROM planning_deals
    WHERE stage = 'production' AND min_monthly_amount IS NOT NULL AND min_monthly_amount > 0
  `).all();

  let created = 0;
  for (const d of deals) {
    const existing = await prepare<{ c: number }>(`
      SELECT COUNT(*) AS c FROM planning_deal_payments
      WHERE deal_id = ? AND paid_at >= ? AND paid_at < ?
    `).get(d.id, monthStart, nextMonth);
    if ((existing?.c ?? 0) > 0) continue;

    // paid_at = same DoM as production_started_at, clamped to month length
    const startDom = d.production_started_at ? new Date(d.production_started_at).getUTCDate() : 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const dom = Math.min(startDom, daysInMonth);
    const paidAt = `${year}-${String(month).padStart(2, "0")}-${String(dom).padStart(2, "0")}`;

    await addDealPayment({
      deal_id: d.id,
      paid_at: paidAt,
      amount: Number(d.min_monthly_amount),
      status: "expected",
    });
    created += 1;
  }

  return NextResponse.json({ processed: deals.length, created });
}
