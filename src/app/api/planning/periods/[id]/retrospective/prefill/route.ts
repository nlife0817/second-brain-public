import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getPeriod, listChangeLog, listInitiatives, listMetrics, listMetricTargets } from "@/lib/db";
import { prepare } from "@/lib/sql";

// Concept §6.7.7. Pre-fill the 4 retrospective fields from change log + metric facts.
export const POST = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const period = await getPeriod(id);
  if (!period) return NextResponse.json({ error: "not found" }, { status: 404 });

  const logs = await listChangeLog({ from: period.start_date, to: period.end_date }, 1000, 0);
  const killed = logs.filter((l) => l.entity_type === "initiative" && l.action === "update" && l.diff && (l.diff as Record<string, { from: unknown; to: unknown }>).status?.to === "killed");
  const killCriteria = logs.filter((l) => l.replan_reason && (l.replan_reason as { code?: string }).code === "kill_criteria_triggered");
  const minor = logs.filter((l) => l.replan_reason && (l.replan_reason as { code?: string }).code === "minor_adjustment");

  // Initiatives in/missed window.
  const finishedInWindow = (await listInitiatives({ status: "done" })).filter(
    (i) => i.done_at && i.done_at >= period.start_date && i.done_at <= period.end_date
  );
  const missed = (await listInitiatives({ status: "planned" })).filter(
    (i) => i.due_period_id && i.due_period_id === period.id
  );

  // Invalidated experiments — initiatives where experiment_decision = 'invalidated' and done_at in window.
  const invalidatedExperiments = (await listInitiatives({})).filter(
    (i) => i.type === "experiment" && i.experiment_decision === "invalidated"
      && i.done_at && i.done_at >= period.start_date && i.done_at <= period.end_date
  );
  const validatedExperiments = (await listInitiatives({})).filter(
    (i) => i.type === "experiment" && i.experiment_decision === "validated"
      && i.done_at && i.done_at >= period.start_date && i.done_at <= period.end_date
  );

  // Revenue vs plan: business metrics with `Выручка` keyword or unit ₽.
  const metrics = await listMetrics();
  const revenueMetric = metrics.find((m) =>
    m.type === "business" && (
      /выручк/i.test(m.title) || m.unit === "rub" || m.unit === "₽" || m.unit === "RUB"
    )
  );
  let revenueLine = "";
  if (revenueMetric) {
    const targets = await listMetricTargets(revenueMetric.id);
    const targetsInWindow = targets.filter((t) => {
      // We only have target rows tied by period_id; ensure period overlaps.
      return true;
    });
    // Sum targets attached to periods within window.
    const matched = await Promise.all(targetsInWindow.map(async (t) => {
      const p = await getPeriod(t.period_id);
      if (!p) return 0;
      if (p.end_date < period.start_date || p.start_date > period.end_date) return 0;
      return Number(t.target_value);
    }));
    const planSum = matched.reduce((s, v) => s + v, 0);

    // P8: confirmed + expected payments в окне периода. Источник —
    // client_deal_payments (бывш. planning_deal_payments).
    const fact = await prepare<{ total: number }>(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM client_deal_payments
      WHERE status IN ('confirmed', 'expected')
        AND paid_at >= ?::date AND paid_at <= ?::date
    `).get(period.start_date, period.end_date);
    const factSum = Number(fact?.total ?? 0);

    if (planSum > 0) {
      const delta = ((factSum - planSum) / planSum) * 100;
      const sign = delta >= 0 ? "+" : "";
      revenueLine = `Выручка: ${factSum.toLocaleString("ru-RU")}₽ vs план ${planSum.toLocaleString("ru-RU")}₽ (${sign}${delta.toFixed(1)}%).`;
    } else if (factSum > 0) {
      revenueLine = `Выручка: ${factSum.toLocaleString("ru-RU")}₽ (план не задан).`;
    }
  }

  // Metrics that missed their target (business + numeric, simple compare aggregate targets vs latest tick).
  const metricMissed: string[] = [];
  for (const m of metrics) {
    if (m.type === "delivery") continue;
    const targets = await listMetricTargets(m.id);
    const targetsInWindow = await Promise.all(targets.map(async (t) => {
      const p = await getPeriod(t.period_id);
      if (!p) return null;
      if (p.end_date < period.start_date || p.start_date > period.end_date) return null;
      return Number(t.target_value);
    }));
    const planSum = targetsInWindow.filter((x): x is number => x !== null).reduce((s, v) => s + v, 0);
    if (planSum === 0) continue;
    const fact = await prepare<{ s: number }>(`
      SELECT COALESCE(SUM(value), 0) AS s
      FROM planning_metric_ticks
      WHERE metric_id = ? AND measured_at >= ?::timestamptz AND measured_at <= ?::timestamptz
    `).get(m.id, period.start_date, period.end_date);
    const factSum = Number(fact?.s ?? 0);
    const isGood = m.direction_value === "down" ? factSum <= planSum : factSum >= planSum;
    if (!isGood) {
      metricMissed.push(`${m.title} — факт ${factSum.toLocaleString("ru-RU")} vs план ${planSum.toLocaleString("ru-RU")}`);
    }
  }

  const draft = {
    what_went_well: [
      finishedInWindow.length ? `Закрыто ${finishedInWindow.length} инициатив в дедлайн: ${finishedInWindow.map((i) => i.title).join(", ")}.` : "",
      revenueLine,
      validatedExperiments.length ? `Эксперименты подтверждены: ${validatedExperiments.map((i) => i.title).join(", ")}.` : "",
    ].filter(Boolean).join(" "),

    what_didnt: [
      missed.length ? `Пропущено ${missed.length} дедлайнов: ${missed.map((i) => i.title).join(", ")}.` : "",
      metricMissed.length ? `Метрики не достигли цели: ${metricMissed.join("; ")}.` : "",
    ].filter(Boolean).join(" "),

    what_to_try: "",

    lessons_learned: [
      killed.length ? `Убитых инициатив: ${killed.length}.` : "",
      killCriteria.length ? `Сработавших kill_criteria: ${killCriteria.length}.` : "",
      invalidatedExperiments.length ? `Эксперименты опровергнуты: ${invalidatedExperiments.map((i) => i.title).join(", ")}.` : "",
      minor.length ? `Минорных правок: ${minor.length}.` : "",
    ].filter(Boolean).join(" "),
  };

  return NextResponse.json(draft);
});
