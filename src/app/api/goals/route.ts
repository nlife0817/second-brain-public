import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import {
  getAllGoals, createGoal, getMetricsForGoals, getGoalsChildrenCounts,
} from "@/lib/db";
import { computeProgressTree } from "@/lib/goals-progress";
import type {
  CreateGoalPayload, GoalAxis, GoalLevel, GoalStatus, GoalFull,
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

  // For aggregated progress we need full tree of metrics, not just filtered subset.
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
    const body: CreateGoalPayload = await req.json();
    if (!body.title?.trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    if (!body.level) return NextResponse.json({ error: "Level is required" }, { status: 400 });

    const goal = await createGoal({ ...body, id: uuid() });
    return NextResponse.json(goal, { status: 201 });
  } catch (e) {
    console.error("POST /api/goals failed", e);
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
