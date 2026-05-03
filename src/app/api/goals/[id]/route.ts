import { NextRequest, NextResponse } from "next/server";
import { getGoalById, updateGoal, deleteGoal, getMetricsForGoal, getGoalsChildrenCounts } from "@/lib/db";
import { goalProgress } from "@/lib/goals-progress";
import type { UpdateGoalPayload } from "@/types";
import { getAuthUser } from "@/lib/auth";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const goal = await getGoalById(id);
  if (!goal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const metrics = await getMetricsForGoal(id);
  const childrenCounts = await getGoalsChildrenCounts();
  return NextResponse.json({
    ...goal,
    metrics,
    progress: goalProgress(metrics, []),
    children_count: childrenCounts.get(id) ?? 0,
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  try {
    const body: UpdateGoalPayload = await req.json();
    const updated = await updateGoal(id, body);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const ok = await deleteGoal(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
