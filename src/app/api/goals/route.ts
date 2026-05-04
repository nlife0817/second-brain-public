import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import {
  getAllGoals, createGoal, getMetricsForGoals, getMetricsForGoal, getGoalsChildrenCounts,
  bulkInsertGoalsAndMetrics, type BulkGoalRow, type BulkMetricRow,
} from "@/lib/db";
import { computeProgressTree } from "@/lib/goals-progress";
import { decomposeChildren } from "@/lib/goals-decompose";
import type {
  CreateGoalPayload, GoalAxis, GoalLevel, GoalStatus, GoalFull, Goal, GoalMetric,
} from "@/types";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const level = sp.get("level") as GoalLevel | null;
  const axis = sp.get("axis") as GoalAxis | null;
  const status = sp.get("status") as GoalStatus | null;
  const parentRaw = sp.get("parent_id");
  const parent_id = parentRaw === "null" ? null : parentRaw ?? undefined;
  const includeMetrics = sp.get("metrics") !== "false";

  const goals = await getAllGoals({
    level: level ?? undefined,
    axis: axis ?? undefined,
    parent_id,
    status: status ?? undefined,
  });

  if (!includeMetrics) return NextResponse.json(goals);

  const allGoals = await getAllGoals();
  const metricsByGoal = await getMetricsForGoals(allGoals.map((g) => g.id));
  const progressByGoal = computeProgressTree(allGoals, metricsByGoal);
  const childrenCounts = await getGoalsChildrenCounts();

  const result: GoalFull[] = goals.map((g) => ({
    ...g,
    metrics: metricsByGoal.get(g.id) ?? [],
    progress: progressByGoal.get(g.id) ?? 0,
    children_count: childrenCounts.get(g.id) ?? 0,
  }));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body: CreateGoalPayload & { auto_decompose?: boolean } = await req.json();
    if (!body.title?.trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    if (!body.level) return NextResponse.json({ error: "Level is required" }, { status: 400 });

    const goal = await createGoal({ ...body, id: uuid() });

    // No default KR on weeks: tasks-KR is created on the quarter (with
    // categories) and cascades down — so weeks only carry KRs that actually
    // exist on the parent chain.

    // Auto-decompose by default for year/quarter/month (recursive down to weeks).
    const auto = body.auto_decompose !== false;
    if (auto && (goal.level === "year" || goal.level === "quarter" || goal.level === "month")) {
      const rootMetrics = await getMetricsForGoal(goal.id);
      const { goals: bulkGoals, metrics: bulkMetrics } = collectDecomposition(goal, rootMetrics);
      await bulkInsertGoalsAndMetrics(bulkGoals, bulkMetrics);
    }

    return NextResponse.json(goal, { status: 201 });
  } catch (e) {
    console.error("POST /api/goals failed", e);
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

/**
 * Walk the decomposition tree in memory (year→quarters→months→weeks) and return
 * flat arrays for a single bulk INSERT.
 *
 * Tasks-KR cascade: when the parent goal has a tasks-KR with categories, the
 * same KR is replicated on every descendant goal (parent_metric_id chain
 * matches the goal tree, categories carry over). This is the only kind that
 * cascades — for numeric/checklist/boolean the user uses the distribution
 * wizard to set per-period plans.
 *
 * One DB round-trip instead of ~130 sequential ones.
 */
function collectDecomposition(parent: Goal, parentMetrics: GoalMetric[]): { goals: BulkGoalRow[]; metrics: BulkMetricRow[] } {
  const goals: BulkGoalRow[] = [];
  const metrics: BulkMetricRow[] = [];
  // Only tasks-KRs cascade automatically. Their categories define what counts
  // toward the KR at every level via due_date+category, so replicating them
  // is just a structural mirror — the user does not need to enter targets.
  const cascadingMetrics = parentMetrics.filter((m) => m.kind === "tasks");
  walk(parent.id, parent.level, parent.period_start, parent.axis, cascadingMetrics, goals, metrics);
  return { goals, metrics };
}

function walk(
  parentId: string,
  parentLevel: GoalLevel,
  parentPeriodStart: string | null,
  axis: GoalAxis | null,
  parentMetrics: GoalMetric[],
  outGoals: BulkGoalRow[],
  outMetrics: BulkMetricRow[],
): void {
  const children = decomposeChildren(parentLevel, parentPeriodStart);
  for (const child of children) {
    const id = uuid();
    outGoals.push({
      id,
      parent_id: parentId,
      level: child.level,
      axis,
      title: child.title,
      description: "",
      status: "active",
      period_start: child.period_start,
      period_end: child.period_end,
      position: child.position,
    });

    // Replicate tasks-KRs onto the child with categories preserved.
    const childMetrics: GoalMetric[] = [];
    for (const pm of parentMetrics) {
      const newId = uuid();
      outMetrics.push({
        id: newId,
        goal_id: id,
        kind: pm.kind,
        title: pm.title,
        unit: pm.unit,
        target_value: null,
        current_value: null,
        start_value: null,
        direction: pm.direction,
        payload: null,
        weight: pm.weight,
        position: pm.position,
        parent_metric_id: pm.id,
        tasks_category_ids: pm.tasks_category_ids,
      });
      childMetrics.push({
        ...pm,
        id: newId,
        goal_id: id,
        target_value: null,
        current_value: null,
        parent_metric_id: pm.id,
      });
    }

    if (child.level !== "week") {
      walk(id, child.level, child.period_start, axis, childMetrics, outGoals, outMetrics);
    }
  }
}
