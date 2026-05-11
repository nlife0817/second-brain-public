import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare, transaction } from "@/lib/sql";
import { upsertPeriod, listMetrics, listMetricTargets, listInitiatives, getPlanningSettings, listPeriods } from "@/lib/db";
import type { Item } from "@/types";
import type { PlanningPeriod } from "@/types/planning";

/** ISO week number — Monday start, simple algorithm. */
function isoWeek(d: Date): { year: number; week: number; start: Date; end: Date } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of current week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 + 1) / 7) + 1;
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - 3);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { year: date.getUTCFullYear(), week, start, end };
}

function fmtDate(d: Date): string { return d.toISOString().slice(0, 10); }

async function ensureWeekPeriod(year: number, week: number, start: Date, end: Date): Promise<PlanningPeriod> {
  const existing = await listPeriods({ type: "week", year, directionId: null });
  const hit = existing.find((p) => p.week_n === week);
  if (hit) return hit;
  return await upsertPeriod({
    direction_id: null,
    type: "week",
    year,
    week_n: week,
    start_date: fmtDate(start),
    end_date: fmtDate(end),
  });
}

export const GET = withAuth(async () => {
  const now = new Date();
  const cur = isoWeek(now);
  const thisWeek = await ensureWeekPeriod(cur.year, cur.week, cur.start, cur.end);

  // Carryover: items from previous week's period that are not done and not yet carried over to this week
  const prev = new Date(cur.start); prev.setUTCDate(cur.start.getUTCDate() - 7);
  const prevW = isoWeek(prev);
  const prevPeriod = (await listPeriods({ type: "week", year: prevW.year, directionId: null })).find((p) => p.week_n === prevW.week);
  if (prevPeriod) {
    await transaction(async (tx) => {
      await tx.prepare(`
        UPDATE items
        SET planned_period_id = ?, planned_date = ?, is_carryover = TRUE, updated_at = ?
        WHERE planned_period_id = ?
          AND status NOT IN ('done', 'archived')
      `).run(thisWeek.id, fmtDate(cur.start), new Date().toISOString(), prevPeriod.id);
    });
  }

  const settings = await getPlanningSettings();
  const initiatives = await listInitiatives({ includeArchivedAfterDays: 60 });
  const metrics = await listMetrics();
  const targetsByMetric: Record<string, number> = {};
  for (const m of metrics) {
    const targets = await listMetricTargets(m.id);
    const hit = targets.find((t) => t.period_id === thisWeek.id);
    if (hit) targetsByMetric[m.id] = Number(hit.target_value);
  }

  const items = await prepare<Item>(
    "SELECT * FROM items WHERE planned_period_id = ? ORDER BY planned_date ASC NULLS LAST, position ASC"
  ).all(thisWeek.id);

  const backlog = await prepare<Item>(
    "SELECT * FROM items WHERE type = 'task' AND status NOT IN ('done','archived') AND planned_period_id IS NULL ORDER BY priority DESC, created_at DESC LIMIT 200"
  ).all();

  return NextResponse.json({
    period: thisWeek,
    settings,
    items,
    backlog,
    metrics,
    targets_by_metric: targetsByMetric,
    initiatives,
  });
});
