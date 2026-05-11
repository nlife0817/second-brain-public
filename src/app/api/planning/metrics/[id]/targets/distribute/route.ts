import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getMetric, listPeriods, listMetricTargets, bulkUpsertMetricTargets } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";
import { distributeTarget } from "@/lib/planning-distribute";
import type { DistributeCurve, PeriodType } from "@/types/planning";

export const POST = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const metric = await getMetric(id);
  if (!metric) return NextResponse.json({ error: "metric not found" }, { status: 404 });

  const body = await req.json();
  const curve: DistributeCurve = body?.curve ?? "linear";
  const yearTarget = Number(body?.year_target);
  const periodType: PeriodType = body?.period_type ?? "quarter";
  const year: number = Number(body?.year ?? new Date().getFullYear());

  if (!Number.isFinite(yearTarget)) {
    return NextResponse.json({ error: "year_target required" }, { status: 400 });
  }

  const periods = (await listPeriods({ directionId: metric.direction_id, type: periodType, year }))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (periods.length === 0) {
    return NextResponse.json({ error: "no periods to distribute over", details: { periodType, year } }, { status: 400 });
  }

  // History curve: load last year's targets for the same periodType and use their shape.
  let historyShares: number[] | undefined;
  if (curve === "history") {
    const lastYearPeriods = (await listPeriods({ directionId: metric.direction_id, type: periodType, year: year - 1 }))
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    if (lastYearPeriods.length === periods.length) {
      const allTargets = await listMetricTargets(id);
      const byPeriod = new Map(allTargets.map((t) => [t.period_id, Number(t.target_value)]));
      historyShares = lastYearPeriods.map((p) => byPeriod.get(p.id) ?? 0);
      if (historyShares.every((v) => v === 0)) historyShares = undefined;
    }
    if (!historyShares) {
      return NextResponse.json({ error: "no history data for previous year", details: { year: year - 1 } }, { status: 400 });
    }
  }

  const values = distributeTarget(curve, yearTarget, periods.length, historyShares);
  const upserts = periods.map((p, i) => ({ metric_id: id, period_id: p.id, target_value: values[i] }));
  const rows = await bulkUpsertMetricTargets(upserts);

  await logChange({
    actor_email: user.email,
    entity_type: "metric_target",
    entity_id: id,
    action: "auto_distribute",
    diff: { curve: { from: null, to: curve }, year_target: { from: null, to: yearTarget }, count: { from: null, to: rows.length } },
    context: { period_type: periodType, year },
  });

  return NextResponse.json(rows);
});
