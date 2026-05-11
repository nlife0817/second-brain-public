import { NextRequest, NextResponse } from "next/server";
import { prepare } from "@/lib/sql";
import { addClientDealPayment, getPlanningSettings } from "@/lib/db";

/**
 * Cron P8: создаёт «expected» платежи на текущий месяц для всех client_deals,
 * где `pilot_started_at IS NOT NULL` (то есть пилот стартовал) и
 * `min_monthly_amount > 0`. Виртуальная выручка от пилота — пользователь
 * подтвердил, что в метрику Выручка она тоже попадает.
 *
 * Источник правды для «начала отсчёта» — pilot_started_at (а не
 * production_started_at, как было в P5). Идемпотентно: повторный вызов
 * за тот же месяц для той же сделки пропускается.
 *
 * Сделки в churned-статусах (settings.churned_status_ids) исключаются.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getPlanningSettings();
  const churned = settings.churned_status_ids ?? [];

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  // Только сделки, у которых пилот стартовал и они не churned.
  const churnedPlaceholders = churned.length > 0
    ? churned.map(() => "?").join(",")
    : "NULL";
  const churnedFilter = churned.length > 0
    ? `AND (status_id IS NULL OR status_id NOT IN (${churnedPlaceholders}))`
    : "";

  const deals = await prepare<{
    id: string;
    min_monthly_amount: number;
    pilot_started_at: string;
  }>(
    `SELECT id, min_monthly_amount, pilot_started_at FROM client_deals
     WHERE pilot_started_at IS NOT NULL
       AND min_monthly_amount IS NOT NULL
       AND min_monthly_amount > 0
       AND pilot_started_at <= now()
       ${churnedFilter}`
  ).all(...churned);

  let created = 0;
  for (const d of deals) {
    const existing = await prepare<{ c: number }>(`
      SELECT COUNT(*) AS c FROM client_deal_payments
      WHERE deal_id = ? AND paid_at >= ? AND paid_at < ?
    `).get(d.id, monthStart, nextMonth);
    if ((existing?.c ?? 0) > 0) continue;

    // paid_at = тот же день месяца, что у pilot_started_at, обрезанный до длины месяца.
    const startDom = new Date(d.pilot_started_at).getUTCDate();
    const daysInMonth = new Date(year, month, 0).getDate();
    const dom = Math.min(startDom, daysInMonth);
    const paidAt = `${year}-${String(month).padStart(2, "0")}-${String(dom).padStart(2, "0")}`;

    // Для уже стартовавших ранее этого месяца сделок генерим текущий month.
    // (Если pilot_started_at > monthStart — paid_at будет в будущем относительно
    // начала месяца, что нормально — это «ожидаемый» платёж.)
    await addClientDealPayment({
      deal_id: d.id,
      paid_at: paidAt,
      amount: Number(d.min_monthly_amount),
      status: "expected",
    });
    created += 1;
  }

  return NextResponse.json({ processed: deals.length, created });
}
