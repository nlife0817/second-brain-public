import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getMetric, listPeriods, listMetricTargets, bulkUpsertMetricTargets } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";
import { distributeTarget } from "@/lib/planning-distribute";
import type { DistributeCurve } from "@/types/planning";

// P4: distribute ВСЕГДА пишет на week-level — независимо от выбранного horizon
// в UI (PLAN_PLANNING_REWORK §0). Quarter/Month — это агрегация недель.
//
// Опциональный body.skip_weeks_before — ISO date — позволяет пропустить ранние
// недели (используется для «Перераспределить недобор», когда хотим разнести
// оставшуюся часть года на оставшиеся недели).
export const POST = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const metric = await getMetric(id);
  if (!metric) return NextResponse.json({ error: "metric not found" }, { status: 404 });

  const body = await req.json();
  const curve: DistributeCurve = body?.curve ?? "linear";
  const yearTarget = Number(body?.year_target);
  const year: number = Number(body?.year ?? new Date().getFullYear());
  const skipBefore: string | null = body?.skip_weeks_before ?? null;

  if (!Number.isFinite(yearTarget)) {
    return NextResponse.json({ error: "year_target required" }, { status: 400 });
  }

  // Источник правды — week-периоды этого года/направления.
  let weeks = (await listPeriods({ directionId: metric.direction_id, type: "week", year }))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (skipBefore) {
    weeks = weeks.filter((w) => w.start_date >= skipBefore);
  }
  if (weeks.length === 0) {
    return NextResponse.json({
      error: "no week periods to distribute over",
      details: { year, skip_weeks_before: skipBefore },
    }, { status: 400 });
  }

  // History curve: read previous year's week-targets и используем их форму.
  let historyShares: number[] | undefined;
  if (curve === "history") {
    const lastYearWeeks = (await listPeriods({ directionId: metric.direction_id, type: "week", year: year - 1 }))
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    if (lastYearWeeks.length === weeks.length) {
      const allTargets = await listMetricTargets(id);
      const byPeriod = new Map(allTargets.map((t) => [t.period_id, Number(t.target_value)]));
      historyShares = lastYearWeeks.map((p) => byPeriod.get(p.id) ?? 0);
      if (historyShares.every((v) => v === 0)) historyShares = undefined;
    }
    if (!historyShares) {
      return NextResponse.json({
        error: "no history data for previous year",
        details: { year: year - 1 },
      }, { status: 400 });
    }
  }

  const values = distributeTarget(curve, yearTarget, weeks.length, historyShares);
  const upserts = weeks.map((p, i) => ({ metric_id: id, period_id: p.id, target_value: values[i] }));
  const rows = await bulkUpsertMetricTargets(upserts);

  await logChange({
    actor_email: user.email,
    entity_type: "metric_target",
    entity_id: id,
    action: "auto_distribute",
    diff: {
      curve: { from: null, to: curve },
      year_target: { from: null, to: yearTarget },
      count: { from: null, to: rows.length },
    },
    context: { period_type: "week", year, skip_weeks_before: skipBefore },
  });

  return NextResponse.json(rows);
});
