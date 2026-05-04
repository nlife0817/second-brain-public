import type { Goal, GoalMetric, GoalFull, MetricPayload } from "@/types";

// Progress of a single Key Result, normalized to [0..1].
// Reads `effective_current` (set by `computeMetricEffectives`) when present —
// that's the rolled-up value from child KRs. Falls back to `current_value` for
// leaf KRs.
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
      const current = numOr(m.effective_current ?? m.current_value, 0);
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
      const current = numOr(m.effective_current ?? m.current_value, 0);
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
      // For parent KRs the effective_current carries the AND result (1/0).
      if (m.effective_current != null) return m.effective_current >= 1 ? 1 : 0;
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
// Mutates metrics in `metricsByGoal` to fill `effective_current` and (for
// parent `tasks` KRs) the rolled-up tasks_done / tasks_total.
export function computeProgressTree(
  goals: Goal[],
  metricsByGoal: Map<string, GoalMetric[]>,
): Map<string, number> {
  // Roll up KR values across the metric inheritance tree first. Metric tree is
  // independent of goal tree (parent_metric_id can span any goals).
  const allMetrics: GoalMetric[] = [];
  for (const arr of metricsByGoal.values()) allMetrics.push(...arr);
  computeMetricEffectives(allMetrics);

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

// Compute `effective_current` for every KR by post-order DFS over the metric
// tree (parent_metric_id). Mutates input array.
//
// Aggregation rules (only when KR has children):
//   numeric up / counter   → sum(child.effective_current)
//   numeric down           → min(child.effective_current ?? start_value)
//   tasks                  → sum tasks_done/tasks_total + effective_current=done
//   boolean                → 1 if every child.payload.done else 0
//   checklist              → not aggregated (kept own current_value)
export function computeMetricEffectives(metrics: GoalMetric[]): void {
  const childrenOf = new Map<string, GoalMetric[]>();
  for (const m of metrics) {
    if (m.parent_metric_id) {
      const arr = childrenOf.get(m.parent_metric_id) ?? [];
      arr.push(m);
      childrenOf.set(m.parent_metric_id, arr);
    }
  }
  const visited = new Set<string>();
  function visit(m: GoalMetric): void {
    if (visited.has(m.id)) return;
    visited.add(m.id);
    const kids = childrenOf.get(m.id) ?? [];
    for (const k of kids) visit(k);

    if (kids.length === 0) {
      m.effective_current = m.current_value ?? null;
      return;
    }

    if (m.kind === "checklist") {
      m.effective_current = m.current_value ?? null;
      return;
    }

    if (m.kind === "boolean") {
      const allDone = kids.every((c) => {
        if (c.effective_current != null) return c.effective_current >= 1;
        return (c.payload as MetricPayload | null)?.done === true;
      });
      m.effective_current = allDone ? 1 : 0;
      return;
    }

    if (m.kind === "tasks") {
      let done = 0; let total = 0;
      for (const c of kids) {
        done += c.tasks_done ?? 0;
        total += c.tasks_total ?? 0;
      }
      m.tasks_done = done;
      m.tasks_total = total;
      m.effective_current = total === 0 ? 0 : done;
      return;
    }

    // numeric / counter
    const childVals = kids
      .map((c) => c.effective_current ?? c.current_value ?? c.start_value ?? null)
      .filter((v): v is number => v != null && Number.isFinite(Number(v)))
      .map(Number);
    if (m.kind === "numeric" && m.direction === "down") {
      m.effective_current = childVals.length ? Math.min(...childVals) : (m.current_value ?? null);
    } else {
      m.effective_current = childVals.reduce((s, v) => s + v, 0);
    }
  }
  for (const m of metrics) visit(m);
}

export function formatMetricValue(m: GoalMetric): string {
  const unit = m.unit ? ` ${m.unit}` : "";
  switch (m.kind) {
    case "tasks":
      return `${m.tasks_done ?? 0}/${m.tasks_total ?? 0}`;
    case "numeric":
    case "counter":
      return `${fmt(m.effective_current ?? m.current_value)} / ${fmt(m.target_value)}${unit}`;
    case "checklist": {
      const items = (m.payload as MetricPayload | null)?.items ?? [];
      const done = items.filter((i) => i.done).length;
      return `${done} / ${items.length}`;
    }
    case "boolean": {
      const eff = m.effective_current;
      const flag = eff != null ? eff >= 1 : (m.payload as MetricPayload | null)?.done;
      return flag ? "Готово" : "Не сделано";
    }
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
