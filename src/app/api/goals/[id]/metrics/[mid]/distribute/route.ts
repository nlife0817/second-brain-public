import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import {
  getAllGoals, getMetricsForGoal, getMetricsForGoals, createMetric, updateMetric,
} from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import type { GoalLevel, GoalMetric } from "@/types";

const NEXT_LEVEL: Record<GoalLevel, GoalLevel | null> = {
  year: "quarter",
  quarter: "month",
  month: "week",
  week: null,
};

interface DistributeBody {
  children: { goal_id: string; target_value: number | null }[];
}

/**
 * Distribute a parent KR's plan across the next-level child goals. Creates a
 * linked KR (parent_metric_id = mid) on each requested child goal with the
 * supplied target_value. If a linked KR already exists on a child, its
 * target_value is updated in place.
 *
 * The kind/unit/direction/start_value/tasks_category_ids are inherited from
 * the parent KR — only target_value is set per child.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; mid: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, mid } = await ctx.params;

  const parentMetrics = await getMetricsForGoal(id);
  const parentMetric = parentMetrics.find((m) => m.id === mid);
  if (!parentMetric) return NextResponse.json({ error: "Parent KR not found" }, { status: 404 });

  const allGoals = await getAllGoals();
  const parentGoal = allGoals.find((g) => g.id === id);
  if (!parentGoal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });

  const childLevel = NEXT_LEVEL[parentGoal.level];
  if (!childLevel) {
    return NextResponse.json({ error: "Goal has no decomposable level" }, { status: 400 });
  }

  const directChildren = allGoals.filter((g) => g.parent_id === id && g.level === childLevel);
  const childrenById = new Map(directChildren.map((g) => [g.id, g]));

  let body: DistributeBody;
  try {
    body = await req.json() as DistributeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!Array.isArray(body.children)) {
    return NextResponse.json({ error: "children: array required" }, { status: 400 });
  }
  for (const c of body.children) {
    if (!c.goal_id || !childrenById.has(c.goal_id)) {
      return NextResponse.json(
        { error: `goal_id ${c.goal_id}: not a direct ${childLevel} child of this goal` },
        { status: 400 },
      );
    }
  }

  const childGoalIds = directChildren.map((g) => g.id);
  const existingByGoal = await getMetricsForGoals(childGoalIds);

  const out: GoalMetric[] = [];
  for (const c of body.children) {
    const existing = (existingByGoal.get(c.goal_id) ?? []).find((m) => m.parent_metric_id === mid);
    const isDownNumeric = parentMetric.kind === "numeric" && parentMetric.direction === "down";
    if (existing) {
      const updated = await updateMetric(existing.id, {
        target_value: c.target_value,
        ...(isDownNumeric ? { start_value: parentMetric.start_value, current_value: parentMetric.start_value } : {}),
      });
      if (updated) out.push(updated);
    } else {
      const created = await createMetric({
        id: uuid(),
        goal_id: c.goal_id,
        kind: parentMetric.kind,
        title: parentMetric.title,
        unit: parentMetric.unit,
        direction: parentMetric.direction,
        target_value: c.target_value,
        current_value: isDownNumeric ? parentMetric.start_value : 0,
        start_value: isDownNumeric ? parentMetric.start_value : null,
        weight: parentMetric.weight,
        parent_metric_id: mid,
        tasks_category_ids: parentMetric.tasks_category_ids,
      });
      out.push(created);
    }
  }

  return NextResponse.json({ metrics: out }, { status: 201 });
}
