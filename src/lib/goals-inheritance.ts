import { v4 as uuid } from "uuid";
import { prepare } from "@/lib/sql";
import { bulkInsertGoalsAndMetrics, type BulkMetricRow } from "@/lib/db";
import type { Goal, GoalMetric } from "@/types";

interface MetricRow {
  id: string;
  goal_id: string;
  kind: GoalMetric["kind"];
}

/**
 * Verifies that `parentMetricId` is a valid ancestor link for a KR living on
 * `childGoalId`:
 *   - parent metric must exist;
 *   - parent.goal must be an ancestor of childGoalId in the goals hierarchy;
 *   - kinds must match (sum-only-makes-sense-with-same-kind invariant).
 *
 * Returns null on success, or an error string describing the failure.
 */
export async function validateParentMetric(
  childGoalId: string,
  childKind: GoalMetric["kind"],
  parentMetricId: string,
): Promise<string | null> {
  const parentMetric = await prepare<MetricRow>(
    "SELECT id, goal_id, kind FROM goal_metrics WHERE id = ?",
  ).get(parentMetricId);
  if (!parentMetric) return "parent_metric_id: parent KR not found";
  if (parentMetric.kind !== childKind) {
    return `parent_metric_id: kind mismatch (parent=${parentMetric.kind}, child=${childKind})`;
  }
  // Walk up the goal chain from childGoalId; the parent metric's goal must
  // appear among ancestors.
  const ancestors = new Set<string>();
  let cur: string | null = childGoalId;
  let safety = 16;
  while (cur && safety-- > 0) {
    ancestors.add(cur);
    const row = await prepare<{ parent_id: string | null }>(
      "SELECT parent_id FROM goals WHERE id = ?",
    ).get(cur);
    cur = row?.parent_id ?? null;
  }
  if (!ancestors.has(parentMetric.goal_id)) {
    return "parent_metric_id: parent KR's goal is not an ancestor of this goal";
  }
  return null;
}

/**
 * For a given parent goal, returns its KRs grouped by kind. UI shows them when
 * a child goal creates a new KR and offers «inherit from».
 */
export async function getInheritableMetrics(parentGoalId: string): Promise<GoalMetric[]> {
  const rows = await prepare<MetricRow & { title: string }>(
    "SELECT id, goal_id, kind, title FROM goal_metrics WHERE goal_id = ? ORDER BY position",
  ).all(parentGoalId);
  return rows as unknown as GoalMetric[];
}

/**
 * Walks the goal subtree rooted at `rootGoalId` and creates a copy of
 * `rootMetric` on every descendant, with `parent_metric_id` chain matching the
 * goal tree (each child KR points at the metric living on its goal-parent).
 *
 * Used when the user adds a top-level KR (e.g. «Выручка 20M ₽» on a year) and
 * wants it materialized across all already-decomposed children. Idempotency
 * guard: descendants that already have a KR with `parent_metric_id` pointing
 * at the rootMetric are skipped.
 */
export async function propagateMetricToDescendants(
  rootGoalId: string,
  rootMetric: GoalMetric,
): Promise<number> {
  const allGoals = await prepare<Goal>("SELECT * FROM goals").all();
  const childrenOf = new Map<string | null, Goal[]>();
  for (const g of allGoals) {
    const arr = childrenOf.get(g.parent_id) ?? [];
    arr.push(g);
    childrenOf.set(g.parent_id, arr);
  }

  // Pre-load existing replicas so re-running propagation is idempotent.
  const existing = await prepare<{ goal_id: string; id: string; parent_metric_id: string | null }>(
    "SELECT id, goal_id, parent_metric_id FROM goal_metrics WHERE parent_metric_id = ?",
  ).all(rootMetric.id);
  const directReplicaByGoal = new Map<string, string>();
  for (const r of existing) directReplicaByGoal.set(r.goal_id, r.id);

  const newMetrics: BulkMetricRow[] = [];
  const parentMetricByGoal = new Map<string, string>();
  parentMetricByGoal.set(rootGoalId, rootMetric.id);

  // BFS: ensures we always have parent's KR id before creating child's.
  const queue: string[] = [rootGoalId];
  while (queue.length > 0) {
    const goalId = queue.shift()!;
    const kids = childrenOf.get(goalId) ?? [];
    for (const k of kids) {
      const parentMetricId = parentMetricByGoal.get(goalId)!;
      let metricId = directReplicaByGoal.get(k.id);
      if (!metricId) {
        metricId = uuid();
        const isDownNumeric = rootMetric.kind === "numeric" && rootMetric.direction === "down";
        newMetrics.push({
          id: metricId,
          goal_id: k.id,
          kind: rootMetric.kind,
          title: rootMetric.title,
          unit: rootMetric.unit,
          target_value: null,
          current_value: null,
          start_value: isDownNumeric ? rootMetric.start_value : null,
          direction: rootMetric.direction,
          payload: null,
          weight: rootMetric.weight,
          position: rootMetric.position,
          parent_metric_id: parentMetricId,
          tasks_category_ids: rootMetric.tasks_category_ids,
        });
      }
      parentMetricByGoal.set(k.id, metricId);
      queue.push(k.id);
    }
  }

  if (newMetrics.length > 0) {
    await bulkInsertGoalsAndMetrics([], newMetrics);
  }
  return newMetrics.length;
}

/**
 * Returns ancestors of a goal (excluding the goal itself), root-first. Useful
 * when the UI wants to show inheritable KRs from any ancestor level.
 */
export async function getGoalAncestors(goalId: string): Promise<Goal[]> {
  const out: Goal[] = [];
  let cur: string | null = goalId;
  let safety = 16;
  let first = true;
  while (cur && safety-- > 0) {
    const row = await prepare<Goal>(
      "SELECT * FROM goals WHERE id = ?",
    ).get(cur);
    if (!row) break;
    if (!first) out.push(row);
    first = false;
    cur = row.parent_id ?? null;
  }
  return out.reverse();
}
