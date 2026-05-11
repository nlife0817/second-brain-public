import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import {
  listMetricTargets,
  listMetricTargetsForPeriodType,
  bulkUpsertMetricTargets,
  patchAggregatedTarget,
  getMetric,
  getPeriod,
} from "@/lib/db";
import { logChange, classifyTargetChange } from "@/lib/planning-changelog";
import type { UpsertMetricTargetInput, ReplanReason, PeriodType } from "@/types/planning";

// GET /api/planning/metrics/[id]/targets
// Без параметров — возвращает все week-row из БД (legacy-форма).
// С ?period_type=quarter|month|week&year=YYYY — возвращает либо реальные
// week-row (week), либо синтезированные SUM-агрегаты (quarter/month).
//
// P4: storage только на week-level (см. PLAN_PLANNING_REWORK §0). Quarter/Month
// читаются как агрегация недель.
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const periodType = url.searchParams.get("period_type") as PeriodType | null;
  const year = url.searchParams.get("year");

  if (periodType && year && (periodType === "quarter" || periodType === "month" || periodType === "week")) {
    const metric = await getMetric(id);
    if (!metric) return NextResponse.json({ error: "metric not found" }, { status: 404 });
    const rows = await listMetricTargetsForPeriodType(id, periodType, Number(year), metric.direction_id);
    return NextResponse.json(rows);
  }

  const rows = await listMetricTargets(id);
  return NextResponse.json(rows);
});

// PATCH /api/planning/metrics/[id]/targets
// items: [{ metric_id, period_id, target_value }]
// Если period.type='week' — прямой upsert.
// Если period.type='quarter'|'month' — pro-rate пропорционально на week-children.
//   (Концепт §0: targets хранятся только на неделях; editing non-week разносит на weeks.)
export const PATCH = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const metric = await getMetric(id);
  if (!metric) return NextResponse.json({ error: "metric not found" }, { status: 404 });
  const body = await req.json();
  const items: UpsertMetricTargetInput[] = Array.isArray(body?.items) ? body.items : [];
  const explicit: ReplanReason | null = body?.replan_reason ?? null;
  if (items.length === 0) return NextResponse.json({ error: "items required" }, { status: 400 });

  // Разделяем items на week / non-week.
  const weekItems: UpsertMetricTargetInput[] = [];
  const aggregateItems: UpsertMetricTargetInput[] = [];
  for (const it of items) {
    const period = await getPeriod(it.period_id);
    if (!period) {
      return NextResponse.json({ error: `period ${it.period_id} not found` }, { status: 400 });
    }
    if (period.type === "week") {
      weekItems.push({ ...it, metric_id: id });
    } else if (period.type === "quarter" || period.type === "month") {
      aggregateItems.push({ ...it, metric_id: id });
    } else if (period.type === "year") {
      return NextResponse.json({
        error: "Year-level target should be saved on planning_metrics.annual_target, not as a target row",
      }, { status: 400 });
    }
  }

  // Auto-classify minor adjustments
  const existing = await listMetricTargets(id);
  const existingByPeriod = new Map(existing.map((t) => [t.period_id, Number(t.target_value)]));
  let allMinor = true;
  for (const it of items) {
    const old = existingByPeriod.get(it.period_id);
    const cls = await classifyTargetChange(old ?? null, Number(it.target_value));
    if (!cls.minor) { allMinor = false; break; }
  }

  const allUpdated: typeof existing = [];
  if (weekItems.length > 0) {
    const r = await bulkUpsertMetricTargets(weekItems);
    allUpdated.push(...r);
  }
  for (const agg of aggregateItems) {
    const r = await patchAggregatedTarget(id, agg.period_id, Number(agg.target_value));
    allUpdated.push(...r);
  }

  const replan: ReplanReason | null = explicit ?? (allMinor ? { code: "minor_adjustment" } : null);
  await logChange({
    actor_email: user.email,
    entity_type: "metric_target",
    entity_id: id,
    action: "bulk_upsert",
    diff: { count: { from: existing.length, to: allUpdated.length } },
    replan_reason: replan,
    context: { items_changed: items.length, weeks: weekItems.length, aggregates: aggregateItems.length },
  });

  return NextResponse.json(allUpdated);
});
