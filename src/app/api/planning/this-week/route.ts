import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare, transaction } from "@/lib/sql";
import {
  upsertPeriod,
  listMetrics,
  listMetricTargets,
  listInitiatives,
  getPlanningSettings,
  listPeriods,
} from "@/lib/db";
import { isoWeek, parseWeekKey, weekStartDate } from "@/lib/iso-week";
import type { Item } from "@/types";
import type { PlanningPeriod, PlanningInitiativeMetricLink } from "@/types/planning";

function fmtDate(d: Date): string { return d.toISOString().slice(0, 10); }

async function ensureWeekPeriod(
  year: number, week: number, start: Date, end: Date,
): Promise<PlanningPeriod> {
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

export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const weekParam = url.searchParams.get("week");
  const directionId = url.searchParams.get("direction_id");

  // Если week передан — берём его. Иначе — текущая неделя.
  let weekInfo;
  if (weekParam) {
    const parsed = parseWeekKey(weekParam);
    if (!parsed) {
      return NextResponse.json({ error: "invalid week format, expected YYYY-Www" }, { status: 400 });
    }
    const monday = weekStartDate(parsed.year, parsed.week);
    weekInfo = isoWeek(monday);
  } else {
    weekInfo = isoWeek(new Date());
  }

  const targetPeriod = await ensureWeekPeriod(
    weekInfo.year, weekInfo.week, weekInfo.start, weekInfo.end,
  );

  // Carryover: тянем из НЕДЕЛИ, ПРЕДШЕСТВУЮЩЕЙ ВЫБРАННОЙ (а не текущей даты).
  // На текущей неделе это работает как раньше; на исторических — корректно.
  // Дополнительно: переносим только если выбранная неделя содержит сегодняшнюю дату
  // или находится в будущем (на исторических неделях carryover не делаем — это
  // нарушило бы хронологию).
  const today = fmtDate(new Date());
  const isCurrentOrFuture = targetPeriod.end_date >= today;
  if (isCurrentOrFuture) {
    const prevStart = new Date(weekInfo.start);
    prevStart.setUTCDate(weekInfo.start.getUTCDate() - 7);
    const prevW = isoWeek(prevStart);
    const prevPeriod = (await listPeriods({ type: "week", year: prevW.year, directionId: null }))
      .find((p) => p.week_n === prevW.week);
    if (prevPeriod && prevPeriod.id !== targetPeriod.id) {
      await transaction(async (tx) => {
        await tx.prepare(`
          UPDATE items
          SET planned_period_id = ?, planned_date = ?, is_carryover = TRUE, updated_at = ?
          WHERE planned_period_id = ?
            AND status NOT IN ('done', 'archived')
        `).run(targetPeriod.id, fmtDate(weekInfo.start), new Date().toISOString(), prevPeriod.id);
      });
    }
  }

  const settings = await getPlanningSettings();

  // Direction-фильтр применяется к метрикам и инициативам.
  const initiatives = await listInitiatives({
    includeArchivedAfterDays: 60,
    ...(directionId ? { directionId } : {}),
  });
  const metrics = await listMetrics(directionId ?? undefined);

  // Targets per metric для выбранной недели
  const targetsByMetric: Record<string, number> = {};
  for (const m of metrics) {
    const targets = await listMetricTargets(m.id);
    const hit = targets.find((t) => t.period_id === targetPeriod.id);
    if (hit) targetsByMetric[m.id] = Number(hit.target_value);
  }

  // initiative ↔ metric links — нужны уже сейчас для P4.
  // Собираем линки по списку текущих инициатив, без N+1 — одним SELECT.
  let initiativeMetricLinks: PlanningInitiativeMetricLink[] = [];
  if (initiatives.length > 0) {
    const placeholders = initiatives.map(() => "?").join(",");
    initiativeMetricLinks = await prepare<PlanningInitiativeMetricLink>(
      `SELECT * FROM planning_initiative_metric_link WHERE initiative_id IN (${placeholders})`
    ).all(...initiatives.map((i) => i.id));
  }

  // Items в неделе (без фильтра по direction — задачи не имеют direction-колонки,
  // direction живёт у их инициатив, а не у items).
  const items = await prepare<Item>(
    "SELECT * FROM items WHERE planned_period_id = ? ORDER BY planned_date ASC NULLS LAST, position ASC"
  ).all(targetPeriod.id);

  // Бэклог: при выбранном direction — фильтруем по связи задача→инициатива→direction.
  // Без direction — весь бэклог.
  let backlog: Item[];
  if (directionId) {
    backlog = await prepare<Item>(`
      SELECT DISTINCT i.*
      FROM items i
      JOIN planning_item_initiative_link l ON l.item_id = i.id
      JOIN planning_initiatives ini ON ini.id = l.initiative_id
      WHERE i.type = 'task'
        AND i.status NOT IN ('done','archived')
        AND i.planned_period_id IS NULL
        AND ini.direction_id = ?
      ORDER BY i.priority DESC, i.created_at DESC
      LIMIT 200
    `).all(directionId);
  } else {
    backlog = await prepare<Item>(
      "SELECT * FROM items WHERE type = 'task' AND status NOT IN ('done','archived') AND planned_period_id IS NULL ORDER BY priority DESC, created_at DESC LIMIT 200"
    ).all();
  }

  return NextResponse.json({
    period: targetPeriod,
    settings,
    items,
    backlog,
    metrics,
    targets_by_metric: targetsByMetric,
    initiatives,
    initiative_metric_links: initiativeMetricLinks,
    direction_id: directionId,
  });
});
