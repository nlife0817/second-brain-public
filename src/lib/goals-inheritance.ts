import { prepare } from "@/lib/sql";
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
