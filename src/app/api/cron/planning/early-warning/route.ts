import { NextRequest, NextResponse } from "next/server";
import { prepare } from "@/lib/sql";
import { getPlanningSettings } from "@/lib/db";

/**
 * Cron: emits notifications_log entries for at-risk planning items.
 *
 * Three checks (concept §3.4.4, §3.5, §6.7.5):
 *   1. Initiative due in next N weeks with < 80% tasks done → planning_early_warning
 *   2. Initiative in_progress with non-empty kill_criteria and no `done` task
 *      activity in the last N weeks → planning_kill_criteria
 *   3. Cascade — initiatives whose dependencies are at-risk also flagged
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
  const weeks = settings.early_warning_weeks ?? 4;
  const cutoffDate = new Date(Date.now() + weeks * 7 * 86400000).toISOString().slice(0, 10);

  // 1) Schedule-based at-risk.
  const scheduleRows = await prepare<{
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

  const atRiskIds = new Set<string>();
  const atRisk = scheduleRows.filter((r) => r.total === 0 || r.done_count / Math.max(1, Number(r.total)) < 0.8);
  for (const r of atRisk) atRiskIds.add(r.initiative_id);

  let warningInserted = 0;
  for (const r of atRisk) {
    const dedupeKey = `planning_early_warning:${r.initiative_id}:${r.due_end}`;
    const res = await prepare(`
      INSERT INTO notifications_log (id, type, target_id, user_email, sent_at)
      VALUES (?, 'planning_early_warning', ?, ?, ?)
      ON CONFLICT (type, target_id, user_email) DO NOTHING
    `).run(crypto.randomUUID(), dedupeKey, "system", new Date().toISOString());
    if (res.changes > 0) warningInserted += 1;
  }

  // 2) Kill criteria — in_progress initiatives with no recent `done` activity.
  const killRows = await prepare<{ id: string; title: string }>(`
    SELECT i.id, i.title
    FROM planning_initiatives i
    WHERE i.status = 'in_progress'
      AND i.kill_criteria IS NOT NULL
      AND length(trim(i.kill_criteria)) > 0
      AND NOT EXISTS (
        SELECT 1 FROM items
        WHERE initiative_id = i.id
          AND status = 'done'
          AND updated_at >= now() - (? || ' weeks')::interval
      )
  `).all(String(weeks));

  let killInserted = 0;
  for (const r of killRows) {
    const dedupeKey = `planning_kill_criteria:${r.id}:${new Date().toISOString().slice(0, 10)}`;
    const res = await prepare(`
      INSERT INTO notifications_log (id, type, target_id, user_email, sent_at)
      VALUES (?, 'planning_kill_criteria', ?, ?, ?)
      ON CONFLICT (type, target_id, user_email) DO NOTHING
    `).run(crypto.randomUUID(), dedupeKey, "system", new Date().toISOString());
    if (res.changes > 0) killInserted += 1;
  }

  // 3) Cascade — initiatives that depend on any at-risk initiative.
  let cascadeInserted = 0;
  if (atRiskIds.size > 0) {
    const cascadeRows = await prepare<{ initiative_id: string; depends_on_initiative_id: string }>(`
      SELECT initiative_id, depends_on_initiative_id
      FROM planning_initiative_dependency
    `).all();
    for (const c of cascadeRows) {
      if (atRiskIds.has(c.depends_on_initiative_id) && !atRiskIds.has(c.initiative_id)) {
        const dedupeKey = `planning_early_warning:cascade:${c.initiative_id}:${c.depends_on_initiative_id}:${new Date().toISOString().slice(0, 10)}`;
        const res = await prepare(`
          INSERT INTO notifications_log (id, type, target_id, user_email, sent_at)
          VALUES (?, 'planning_early_warning', ?, ?, ?)
          ON CONFLICT (type, target_id, user_email) DO NOTHING
        `).run(crypto.randomUUID(), dedupeKey, "system", new Date().toISOString());
        if (res.changes > 0) cascadeInserted += 1;
      }
    }
  }

  return NextResponse.json({
    schedule_candidates: scheduleRows.length,
    at_risk: atRisk.length,
    early_warning_inserted: warningInserted,
    kill_criteria_checked: killRows.length,
    kill_criteria_inserted: killInserted,
    cascade_inserted: cascadeInserted,
  });
}
