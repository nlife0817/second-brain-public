import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import {
  getAllGoals, createGoal, getMetricsForGoals, getMetricsForGoal, getGoalsChildrenCounts, createMetric,
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

    // Default tasks-metric on every freshly-created week.
    if (goal.level === "week") {
      await createMetric({
        id: uuid(),
        goal_id: goal.id,
        kind: "tasks",
        title: "Задачи",
        weight: 1,
        position: 0,
      });
    }

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
 * Inheritance: every KR on the root goal is replicated on each descendant
 * (target_value=null so the user fills in the per-period plan). The replicas
 * carry parent_metric_id pointing at the corresponding parent-level KR so
 * computeMetricEffectives can roll values back up.
 *
 * Weeks always get a default `tasks` KR if no inherited tasks KR is present.
 *
 * One DB round-trip instead of ~130 sequential ones — decomposing a year now
 * takes ~100ms instead of 5–15s.
 */
function collectDecomposition(parent: Goal, parentMetrics: GoalMetric[]): { goals: BulkGoalRow[]; metrics: BulkMetricRow[] } {
  const goals: BulkGoalRow[] = [];
  const metrics: BulkMetricRow[] = [];
  walk(parent.id, parent.level, parent.period_start, parent.axis, parentMetrics, goals, metrics);
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

    // Inherit each KR from the immediate parent goal. The new replica points
    // back at its parent KR (parent_metric_id) — that's what the rollup uses.
    const childMetrics: GoalMetric[] = [];
    for (const pm of parentMetrics) {
      const newId = uuid();
      const replica: BulkMetricRow = {
        id: newId,
        goal_id: id,
        kind: pm.kind,
        title: pm.title,
        unit: pm.unit,
        target_value: null,
        current_value: null,
        start_value: pm.kind === "numeric" && pm.direction === "down" ? pm.start_value : null,
        direction: pm.direction,
        payload: null,
        weight: pm.weight,
        position: pm.position,
        parent_metric_id: pm.id,
        tasks_category_ids: pm.tasks_category_ids,
      };
      outMetrics.push(replica);
      // Synthetic GoalMetric for the next-level recursion. Only the fields we
      // pass to walk's parentMetrics are meaningful here.
      childMetrics.push({
        ...pm,
        id: newId,
        goal_id: id,
        target_value: null,
        current_value: null,
        parent_metric_id: pm.id,
      });
    }

    // Weeks need a tasks KR for the day-projection to be useful. Skip if an
    // inherited KR is already kind=tasks.
    if (child.level === "week" && !childMetrics.some((m) => m.kind === "tasks")) {
      outMetrics.push({
        id: uuid(),
        goal_id: id,
        kind: "tasks",
        title: "Задачи",
        unit: null,
        target_value: null,
        current_value: null,
        start_value: null,
        direction: "up",
        payload: null,
        weight: 1,
        position: parentMetrics.length,
        parent_metric_id: null,
        tasks_category_ids: null,
      });
    } else if (child.level !== "week") {
      walk(id, child.level, child.period_start, axis, childMetrics, outGoals, outMetrics);
    }
  }
}
