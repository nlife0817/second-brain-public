import { NextRequest, NextResponse } from "next/server";
import { prepare } from "@/lib/sql";
import { getPlanningSettings } from "@/lib/db";

/** Cron: emit notifications_log entry "planning_early_warning" for at-risk initiatives. */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getPlanningSettings();
  const weeks = settings.early_warning_weeks ?? 4;
  const cutoffDate = new Date(Date.now() + weeks * 7 * 86400000).toISOString().slice(0, 10);

  // Initiative with due_period end_date within the early-warning window and
  // progress < 80% of tasks done.
  const rows = await prepare<{
    initiative_id: string;
    title: string;
    due_end: string;
    total: number;
    done_count: number;
  }>(`
    SELECT i.id AS initiative_id, i.title, p.end_date AS due_end,
           COALESCE(t.total, 0) AS total, COALESCE(t.done_count, 0) AS done_count
    FROM planning_initiatives i
    JOIN planning_periods p ON p.id = i.due_period_id
    LEFT JOIN (
      SELECT initiative_id,
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_count
      FROM items WHERE initiative_id IS NOT NULL GROUP BY initiative_id
    ) t ON t.initiative_id = i.id
    WHERE i.status NOT IN ('done', 'killed')
      AND p.end_date <= ?::date
      AND p.end_date >= now()::date
  `).all(cutoffDate);

  const atRisk = rows.filter((r) => r.total === 0 || r.done_count / Math.max(1, Number(r.total)) < 0.8);
  let inserted = 0;
  for (const r of atRisk) {
    const dedupeKey = `planning_early_warning:${r.initiative_id}:${r.due_end}`;
    await prepare(`
      INSERT INTO notifications_log (id, type, target_id, user_email, sent_at)
      VALUES (?, 'planning_early_warning', ?, ?, ?)
      ON CONFLICT (type, target_id, user_email) DO NOTHING
    `).run(crypto.randomUUID(), dedupeKey, "system", new Date().toISOString());
    inserted += 1;
  }
  return NextResponse.json({ candidates: rows.length, at_risk: atRisk.length, inserted });
}
