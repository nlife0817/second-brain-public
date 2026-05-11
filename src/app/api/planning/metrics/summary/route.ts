import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare } from "@/lib/sql";
import { listMetrics } from "@/lib/db";

// GET /api/planning/metrics/summary
// Батч для "Колонки": для каждой метрики возвращает sparkline (последние N
// тиков ASC), latest, и YTD-агрегат. Раньше клиент в planning-store.fetchAll
// гонял 2×N round-trips (отдельно ticks и ytd на каждую метрику).
//
// Источники:
//   * sparkline/latest — planning_metric_ticks (для business+second_brain —
//     синтез из client_deal_payments через listEffectiveMetricTicks);
//   * target_ytd — SUM(week-таргетов до today, year, direction);
//   * actual_ytd — SUM(тиков year ≤ today) или последний tick (non-cumulative)
//                  или SUM(client_deal_payments) для business+second_brain.
//
// Параметры:
//   year   — год для YTD (default: current)
//   sparkN — сколько последних точек включать в sparkline (default: 20)
export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());
  const sparkN = Math.max(1, Math.min(100, Number(url.searchParams.get("sparkN") ?? 20)));
  const today = new Date().toISOString().slice(0, 10);

  const metrics = await listMetrics();
  if (metrics.length === 0) return NextResponse.json([]);

  const ids = metrics.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(",");

  // Один запрос — последние тики всех метрик ASC по measured_at, лимит на
  // метрику делается JS-срезом (PostgreSQL window-function вариант тоже работал
  // бы, но усложняет код, а N маленький).
  const ticksPromise = prepare<{ metric_id: string; value: string | number; measured_at: string }>(
    `SELECT metric_id, value, measured_at
     FROM planning_metric_ticks
     WHERE metric_id IN (${placeholders})
     ORDER BY measured_at ASC`,
  ).all(...ids);

  // Деньги: business + source='second_brain' читают факт из client_deal_payments.
  // Один SELECT для актуальных метрик; разносим в JS.
  const dealMetricIds = metrics
    .filter((m) => m.type === "business" && m.source === "second_brain")
    .map((m) => m.id);
  const dealsPromise = dealMetricIds.length === 0
    ? Promise.resolve([] as Array<{ amount: string | number; paid_at: string }>)
    : prepare<{ amount: string | number; paid_at: string }>(
        `SELECT p.amount, p.paid_at
         FROM client_deal_payments p
         JOIN client_deals d ON d.id = p.deal_id
         ORDER BY p.paid_at ASC`,
      ).all();

  // target_ytd — все week-таргеты по году/year, обрезанные today.
  const targetYtdPromise = prepare<{ metric_id: string; s: string }>(
    `SELECT t.metric_id, COALESCE(SUM(t.target_value), 0)::text AS s
     FROM planning_metric_targets t
     JOIN planning_periods p ON p.id = t.period_id
     WHERE t.metric_id IN (${placeholders})
       AND p.type = 'week'
       AND p.year = ?
       AND p.end_date <= ?
     GROUP BY t.metric_id`,
  ).all(...ids, year, today);

  const [tickRows, dealRows, targetRows] = await Promise.all([
    ticksPromise, dealsPromise, targetYtdPromise,
  ]);

  // tick groupby
  const ticksByMetric = new Map<string, Array<{ value: number; measured_at: string }>>();
  for (const t of tickRows) {
    let arr = ticksByMetric.get(t.metric_id);
    if (!arr) { arr = []; ticksByMetric.set(t.metric_id, arr); }
    arr.push({ value: Number(t.value), measured_at: t.measured_at });
  }

  const targetByMetric = new Map<string, number>();
  for (const r of targetRows) targetByMetric.set(r.metric_id, Number(r.s));

  // Deal payments: для business+second_brain используем единый список.
  // Sparkline = последние sparkN платежей по времени; YTD = SUM по году ≤ today.
  const dealsSorted = dealRows.map((d) => ({ value: Number(d.amount), measured_at: d.paid_at }));
  const dealsYtdSum = dealsSorted.reduce(
    (s, d) => (d.measured_at <= today && d.measured_at.slice(0, 4) === String(year) ? s + d.value : s),
    0,
  );

  const result = metrics.map((m) => {
    const useDeals = m.type === "business" && m.source === "second_brain";
    const seriesAll = useDeals ? dealsSorted : (ticksByMetric.get(m.id) ?? []);
    const series = seriesAll.slice(-sparkN);
    const sparkline = series.map((s) => s.value);
    const latest = series.length > 0 ? series[series.length - 1].value : null;
    const target_ytd = targetByMetric.get(m.id) ?? 0;

    let actual_ytd = 0;
    if (useDeals) {
      actual_ytd = dealsYtdSum;
    } else if (m.is_cumulative) {
      actual_ytd = seriesAll.reduce(
        (s, t) => (t.measured_at <= today && t.measured_at.slice(0, 4) === String(year) ? s + t.value : s),
        0,
      );
    } else {
      const last = [...seriesAll].reverse().find(
        (t) => t.measured_at <= today && t.measured_at.slice(0, 4) === String(year),
      );
      actual_ytd = last ? last.value : 0;
    }

    return {
      id: m.id,
      sparkline,
      latest,
      ytd: {
        annual_target: m.annual_target == null ? null : Number(m.annual_target),
        target_ytd,
        actual_ytd,
        variance: actual_ytd - target_ytd,
      },
    };
  });

  return NextResponse.json(result);
});
