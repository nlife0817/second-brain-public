import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare, transaction } from "@/lib/sql";
import {
  upsertPeriod,
  listMetrics,
  listInitiatives,
  getPlanningSettings,
  getAllDevelopmentParticipants,
  listEffectiveCapacities,
} from "@/lib/db";
import { isoWeek, parseWeekKey, weekStartDate } from "@/lib/iso-week";
import type { Item, DevelopmentParticipant } from "@/types";
import type {
  PlanningPeriod,
  PlanningInitiativeMetricLink,
  PlanningMetricTarget,
  EffectiveCapacity,
} from "@/types/planning";

function fmtDate(d: Date): string { return d.toISOString().slice(0, 10); }

// Точечный lookup по слоту (direction_id IS NULL, type='week', year, week_n) —
// заменяет `listPeriods({year}).find(p => p.week_n === w)`, который грузил
// все 52+ строки года ради одной.
async function findWeekPeriod(year: number, week: number): Promise<PlanningPeriod | undefined> {
  return await prepare<PlanningPeriod>(
    `SELECT * FROM planning_periods
     WHERE direction_id IS NULL AND type = 'week' AND year = ? AND week_n = ?
     LIMIT 1`,
  ).get(year, week);
}

async function getOrCreateWeekPeriod(
  year: number, week: number, start: Date, end: Date,
): Promise<PlanningPeriod> {
  const hit = await findWeekPeriod(year, week);
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

  const targetPeriod = await getOrCreateWeekPeriod(
    weekInfo.year, weekInfo.week, weekInfo.start, weekInfo.end,
  );

  // Carryover из предыдущей недели — только на текущей/будущей неделе.
  // На исторических неделях carryover не делаем (нарушает хронологию).
  const today = fmtDate(new Date());
  const isCurrentOrFuture = targetPeriod.end_date >= today;
  if (isCurrentOrFuture) {
    const prevStart = new Date(weekInfo.start);
    prevStart.setUTCDate(weekInfo.start.getUTCDate() - 7);
    const prevW = isoWeek(prevStart);
    const prevPeriod = await findWeekPeriod(prevW.year, prevW.week);
    if (prevPeriod && prevPeriod.id !== targetPeriod.id) {
      // EXISTS-чек перед записью: убирает лишний UPDATE+транзакцию на каждом GET,
      // когда переносить нечего (а это типичный кейс — страница часто перезагружается
      // после любого drag/save). Без чека UPDATE сериализуется в pg на pk-locks.
      const hasCandidates = await prepare<{ ok: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM items
           WHERE planned_period_id = ?
             AND status NOT IN ('done', 'archived')
         ) AS ok`,
      ).get(prevPeriod.id);
      if (hasCandidates?.ok) {
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
  }

  // Параллелим всё, что не зависит друг от друга. Раньше шло 7 await-ов подряд.
  const [
    settings,
    initiatives,
    metrics,
    items,
    backlog,
    participants,
    effectiveCapacities,
  ] = await Promise.all([
    getPlanningSettings(),
    listInitiatives({
      includeArchivedAfterDays: 60,
      ...(directionId ? { directionId } : {}),
    }),
    listMetrics(directionId ?? undefined),
    // Items в неделе.
    prepare<Item>(
      "SELECT * FROM items WHERE planned_period_id = ? ORDER BY planned_date ASC NULLS LAST, position ASC",
    ).all(targetPeriod.id),
    // F5: бэклог — весь пул запланированных задач без фильтра по направлению
    // (пользователь фильтрует через UI). LIMIT 500 — защита от взрыва payload.
    prepare<Item>(
      "SELECT * FROM items WHERE type = 'task' AND status NOT IN ('done','archived') AND planned_period_id IS NULL ORDER BY priority DESC, created_at DESC LIMIT 500",
    ).all() as Promise<Item[]>,
    getAllDevelopmentParticipants() as Promise<DevelopmentParticipant[]>,
    listEffectiveCapacities(targetPeriod.id) as Promise<EffectiveCapacity[]>,
  ]);

  // Второй фен-аут — зависит от списков metrics/initiatives, поэтому отдельный Promise.all.
  const metricIds = metrics.map((m) => m.id);
  const initiativeIds = initiatives.map((i) => i.id);

  const [initiativeMetricLinks, targetRows, tickRows] = await Promise.all([
    initiativeIds.length === 0
      ? Promise.resolve([] as PlanningInitiativeMetricLink[])
      : prepare<PlanningInitiativeMetricLink>(
          `SELECT * FROM planning_initiative_metric_link
           WHERE initiative_id IN (${initiativeIds.map(() => "?").join(",")})`,
        ).all(...initiativeIds),
    // Было: N+1 — listMetricTargets(metricId) на каждую метрику, грузил все
    // таргеты по всем периодам, потом JS-find. Стало: один прицельный SELECT.
    metricIds.length === 0
      ? Promise.resolve([] as PlanningMetricTarget[])
      : prepare<PlanningMetricTarget>(
          `SELECT * FROM planning_metric_targets
           WHERE period_id = ?
             AND metric_id IN (${metricIds.map(() => "?").join(",")})`,
        ).all(targetPeriod.id, ...metricIds),
    metricIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; metric_id: string; value: string | number; measured_at: string; source: string | null }>)
      : prepare<{ id: string; metric_id: string; value: string | number; measured_at: string; source: string | null }>(
          `SELECT id, metric_id, value, measured_at, source
           FROM planning_metric_ticks
           WHERE metric_id IN (${metricIds.map(() => "?").join(",")})
             AND measured_at >= ?
             AND measured_at <= ?
           ORDER BY measured_at ASC`,
        ).all(...metricIds, targetPeriod.start_date, targetPeriod.end_date),
  ]);

  const targetsByMetric: Record<string, number> = {};
  for (const t of targetRows) {
    targetsByMetric[t.metric_id] = Number(t.target_value);
  }

  // Тики — один проход. Раньше было O(N×T) из-за filter в цикле по метрикам.
  const ticksByMetric = new Map<string, Array<{ id: string; value: number; measured_at: string; source: string | null }>>();
  for (const t of tickRows) {
    let arr = ticksByMetric.get(t.metric_id);
    if (!arr) { arr = []; ticksByMetric.set(t.metric_id, arr); }
    arr.push({ id: t.id, value: Number(t.value), measured_at: t.measured_at, source: t.source });
  }
  const metricActuals: Record<string, { ticks: Array<{ id: string; value: number; measured_at: string; source: string | null }>; aggregated: number | null }> = {};
  for (const m of metrics) {
    const mt = ticksByMetric.get(m.id) ?? [];
    let aggregated: number | null = null;
    if (mt.length > 0) {
      aggregated = m.is_cumulative
        ? mt.reduce((s, x) => s + x.value, 0)
        : mt[mt.length - 1].value;
    }
    metricActuals[m.id] = { ticks: mt, aggregated };
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
    participants,
    effective_capacities: effectiveCapacities,
    metric_actuals_for_week: metricActuals,
  });
});
