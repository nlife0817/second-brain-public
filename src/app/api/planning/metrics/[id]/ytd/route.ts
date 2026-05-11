import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getMetric } from "@/lib/db";
import { prepare } from "@/lib/sql";

// GET /api/planning/metrics/[id]/ytd?year=YYYY
// Возвращает агрегат по году:
//   - annual_target — из planning_metrics.annual_target
//   - target_ytd — SUM(week-targets where week.end_date <= today AND year=year)
//   - actual_ytd — для cumulative: SUM(ticks where measured_at <= today AND year);
//                  для non-cumulative: значение последнего tick'а года.
//   - variance — actual_ytd - target_ytd
//
// Используется на карточке метрики (variance indicator) и для расчёта redistribute.
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());
  const today = new Date().toISOString().slice(0, 10);

  const metric = await getMetric(id);
  if (!metric) return NextResponse.json({ error: "metric not found" }, { status: 404 });

  const annual = metric.annual_target == null ? null : Number(metric.annual_target);

  // P5+P8: для business + source='second_brain' источник actual_ytd —
  // client_deal_payments (SUM amount per год, expected + confirmed, включая
  // виртуальную выручку от pilot_started). Для остальных — ticks.
  const useDealPayments = metric.type === "business" && metric.source === "second_brain";

  const targetPromise = prepare<{ s: string }>(`
    SELECT COALESCE(SUM(t.target_value), 0)::text AS s
    FROM planning_metric_targets t
    JOIN planning_periods p ON p.id = t.period_id
    WHERE t.metric_id = ?
      AND p.type = 'week'
      AND p.year = ?
      AND p.end_date <= ?
      AND p.direction_id IS NOT DISTINCT FROM ?
  `).get(id, year, today, metric.direction_id);

  const actualPromise: Promise<{ s?: string; v?: string } | undefined> = useDealPayments
    ? prepare<{ s: string }>(`
        SELECT COALESCE(SUM(amount), 0)::text AS s
        FROM client_deal_payments
        WHERE paid_at <= ?
          AND EXTRACT(YEAR FROM paid_at) = ?
      `).get(today, year)
    : metric.is_cumulative
      ? prepare<{ s: string }>(`
          SELECT COALESCE(SUM(value), 0)::text AS s
          FROM planning_metric_ticks
          WHERE metric_id = ?
            AND measured_at <= ?
            AND EXTRACT(YEAR FROM measured_at) = ?
        `).get(id, today, year)
      : prepare<{ v: string }>(`
          SELECT value::text AS v
          FROM planning_metric_ticks
          WHERE metric_id = ?
            AND measured_at <= ?
            AND EXTRACT(YEAR FROM measured_at) = ?
          ORDER BY measured_at DESC
          LIMIT 1
        `).get(id, today, year);

  const [tRow, aRow] = await Promise.all([targetPromise, actualPromise]);
  const target_ytd = tRow ? Number(tRow.s) : 0;
  let actual_ytd = 0;
  if (aRow) {
    if (useDealPayments || metric.is_cumulative) actual_ytd = Number(aRow.s);
    else actual_ytd = Number(aRow.v);
  }

  return NextResponse.json({
    annual_target: annual,
    target_ytd,
    actual_ytd,
    variance: actual_ytd - target_ytd,
  });
});
