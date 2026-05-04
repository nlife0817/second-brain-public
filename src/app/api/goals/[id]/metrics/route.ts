import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getMetricsForGoal, createMetric, getGoalById } from "@/lib/db";
import { validateParentMetric } from "@/lib/goals-inheritance";
import type { CreateMetricPayload } from "@/types";
import { getAuthUser } from "@/lib/auth";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const metrics = await getMetricsForGoal(id);
  return NextResponse.json(metrics);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const goal = await getGoalById(id);
  if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  try {
    const body: CreateMetricPayload = await req.json();
    if (!body.title?.trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    if (!body.kind) return NextResponse.json({ error: "Kind is required" }, { status: 400 });
    if (body.parent_metric_id) {
      const err = await validateParentMetric(id, body.kind, body.parent_metric_id);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }
    if (body.kind === "tasks") {
      const cats = body.tasks_category_ids ?? [];
      if (!Array.isArray(cats) || cats.length === 0) {
        return NextResponse.json(
          { error: "tasks_category_ids: at least one category required" },
          { status: 400 },
        );
      }
    }
    const metric = await createMetric({ ...body, id: uuid(), goal_id: id });
    return NextResponse.json(metric, { status: 201 });
  } catch (e) {
    console.error("POST /api/goals/[id]/metrics failed", e);
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
