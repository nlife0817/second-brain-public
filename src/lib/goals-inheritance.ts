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
 *
 * Implementation: a single recursive CTE walks the goal chain server-side and
 * joins it to goal_metrics in one shot, instead of issuing one SELECT per
 * ancestor (which used to be up to 16 round-trips per metric POST).
 */
export async function validateParentMetric(
  childGoalId: string,
  childKind: GoalMetric["kind"],
  parentMetricId: string,
): Promise<string | null> {
  const row = await prepare<{
    metric_id: string | null;
    metric_kind: GoalMetric["kind"] | null;
    metric_goal_id: string | null;
    is_ancestor: number | boolean;
  }>(
    `WITH RECURSIVE chain(id, parent_id, depth) AS (
       SELECT id, parent_id, 0 FROM goals WHERE id = ?
       UNION ALL
       SELECT g.id, g.parent_id, c.depth + 1
         FROM goals g JOIN chain c ON g.id = c.parent_id
        WHERE c.depth < 16
     )
     SELECT m.id        AS metric_id,
            m.kind      AS metric_kind,
            m.goal_id   AS metric_goal_id,
            EXISTS (SELECT 1 FROM chain WHERE chain.id = m.goal_id) AS is_ancestor
       FROM goal_metrics m
      WHERE m.id = ?`,
  ).get(childGoalId, parentMetricId);

  if (!row || !row.metric_id) return "parent_metric_id: parent KR not found";
  if (row.metric_kind !== childKind) {
    return `parent_metric_id: kind mismatch (parent=${row.metric_kind}, child=${childKind})`;
  }
  // Postgres returns boolean true; some drivers serialize as 1/0. Accept both.
  const ok = row.is_ancestor === true || row.is_ancestor === 1;
  if (!ok) {
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
