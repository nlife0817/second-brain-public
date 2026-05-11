import { NextRequest, NextResponse } from "next/server";
import { prepare } from "@/lib/sql";

/**
 * Cron: emits notifications_log type='planning_pilot_overdue' for deals
 * whose pilot_planned_end_at has passed but stage is still 'pilot'.
 *
 * See planning_system_concept.md §6.7.5.
 * Auth: Bearer ${CRON_SECRET}.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prepare<{
    id: string; title: string; pilot_planned_end_at: string;
  }>(`
    SELECT id, title, pilot_planned_end_at
    FROM planning_deals
    WHERE stage = 'pilot'
      AND pilot_ended_at IS NULL
      AND pilot_planned_end_at IS NOT NULL
      AND pilot_planned_end_at < now()
  `).all();

  let inserted = 0;
  for (const r of rows) {
    const dedupeKey = `planning_pilot_overdue:${r.id}:${r.pilot_planned_end_at.slice(0, 10)}`;
    const res = await prepare(`
      INSERT INTO notifications_log (id, type, target_id, user_email, sent_at)
      VALUES (?, 'planning_pilot_overdue', ?, ?, ?)
      ON CONFLICT (type, target_id, user_email) DO NOTHING
    `).run(crypto.randomUUID(), dedupeKey, "system", new Date().toISOString());
    if (res.changes > 0) inserted += 1;
  }

  return NextResponse.json({ candidates: rows.length, inserted });
}
