import type { Goal, GoalMetric, GoalFull, MetricPayload } from "@/types";

// Progress of a single Key Result, normalized to [0..1].
export function metricProgress(m: GoalMetric): number {
  switch (m.kind) {
    case "tasks": {
      const total = m.tasks_total ?? 0;
      const done = m.tasks_done ?? 0;
      if (total === 0) return 0;
      return clamp(done / total);
    }
    case "numeric": {
      const target = numOr(m.target_value, 0);
      const current = numOr(m.current_value, 0);
      if (m.direction === "down") {
        const start = numOr(m.start_value, current);
        const span = start - target;
        if (span <= 0) return current <= target ? 1 : 0;
        return clamp((start - current) / span);
      }
      if (target === 0) return 0;
      return clamp(current / target);
    }
    case "counter": {
      const target = numOr(m.target_value, 0);
      const current = numOr(m.current_value, 0);
      if (target === 0) return 0;
      return clamp(current / target);
    }
    case "checklist": {
      const items = (m.payload as MetricPayload | null)?.items ?? [];
      if (items.length === 0) return 0;
      const done = items.filter((i) => i.done).length;
      return clamp(done / items.length);
    }
    case "boolean": {
      return (m.payload as MetricPayload | null)?.done ? 1 : 0;
    }
  }
}

// Goal progress: weighted average of its KRs. If no KRs — average of children.
// `allGoals` lets us recurse without fetching, but children aggregation happens
// only when explicit `childrenProgress` is supplied (server-side computation).
export function goalProgressFromMetrics(metrics: GoalMetric[]): number | null {
  if (!metrics.length) return null;
  const totalW = metrics.reduce((s, m) => s + (m.weight || 0), 0) || metrics.length;
  const weighted = metrics.reduce((s, m) => s + metricProgress(m) * (m.weight || 1), 0);
  return clamp(weighted / totalW);
}

// Aggregate goal progress from KRs first, falling back to mean of children.
export function goalProgress(
  metrics: GoalMetric[],
  childrenProgress: number[],
): number {
  const own = goalProgressFromMetrics(metrics);
  if (own !== null) return own;
  if (childrenProgress.length === 0) return 0;
  return clamp(childrenProgress.reduce((s, p) => s + p, 0) / childrenProgress.length);
}

// Build progress for the entire goals tree in one pass (post-order DFS).
export function computeProgressTree(
  goals: Goal[],
  metricsByGoal: Map<string, GoalMetric[]>,
): Map<string, number> {
  const childrenByParent = new Map<string | null, Goal[]>();
  for (const g of goals) {
    const arr = childrenByParent.get(g.parent_id) ?? [];
    arr.push(g);
    childrenByParent.set(g.parent_id, arr);
  }
  const out = new Map<string, number>();
  function visit(g: Goal): number {
    const childs = childrenByParent.get(g.id) ?? [];
    const childProgs = childs.map(visit);
    const p = goalProgress(metricsByGoal.get(g.id) ?? [], childProgs);
    out.set(g.id, p);
    return p;
  }
  for (const root of childrenByParent.get(null) ?? []) visit(root);
  return out;
}

export function formatMetricValue(m: GoalMetric): string {
  const unit = m.unit ? ` ${m.unit}` : "";
  switch (m.kind) {
    case "tasks":
      return `${m.tasks_done ?? 0}/${m.tasks_total ?? 0}`;
    case "numeric":
    case "counter":
      return `${fmt(m.current_value)} / ${fmt(m.target_value)}${unit}`;
    case "checklist": {
      const items = (m.payload as MetricPayload | null)?.items ?? [];
      const done = items.filter((i) => i.done).length;
      return `${done} / ${items.length}`;
    }
    case "boolean":
      return (m.payload as MetricPayload | null)?.done ? "Готово" : "Не сделано";
  }
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
function numOr(v: number | null | undefined, fallback: number): number {
  return v == null || !Number.isFinite(Number(v)) ? fallback : Number(v);
}
function fmt(v: number | null | undefined): string {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU");
}

export function withFullProgress(goal: Goal, metrics: GoalMetric[], childrenCount: number): GoalFull {
  return {
    ...goal,
    metrics,
    progress: goalProgress(metrics, []),
    children_count: childrenCount,
  };
}
