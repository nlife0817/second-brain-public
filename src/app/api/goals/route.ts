import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import {
  getAllGoals, createGoal, getMetricsForGoals, getGoalsChildrenCounts, createMetric,
} from "@/lib/db";
import { computeProgressTree } from "@/lib/goals-progress";
import { decomposeChildren } from "@/lib/goals-decompose";
import type {
  CreateGoalPayload, GoalAxis, GoalLevel, GoalStatus, GoalFull, Goal,
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
      await decomposeRecursively(goal);
    }

    return NextResponse.json(goal, { status: 201 });
  } catch (e) {
    console.error("POST /api/goals failed", e);
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

/** Recursively create year→quarters→months→weeks. Each created week also gets a default 'tasks' KR. */
async function decomposeRecursively(parent: Goal): Promise<void> {
  const children = decomposeChildren(parent.level, parent.period_start);
  for (const child of children) {
    const created = await createGoal({
      id: uuid(),
      parent_id: parent.id,
      level: child.level,
      axis: parent.axis,
      title: child.title,
      description: "",
      status: "active",
      period_start: child.period_start,
      period_end: child.period_end,
      position: child.position,
    });
    if (created.level === "week") {
      await createMetric({
        id: uuid(),
        goal_id: created.id,
        kind: "tasks",
        title: "Задачи",
        weight: 1,
        position: 0,
      });
    } else {
      await decomposeRecursively(created);
    }
  }
}
