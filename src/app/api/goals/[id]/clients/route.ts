import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getClientRevenueForGoal, createClientRevenue, getGoalById } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import type { CreateClientRevenuePayload } from "@/types";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rows = await getClientRevenueForGoal(id);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const goal = await getGoalById(id);
  if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  if (goal.level !== "week") {
    return NextResponse.json(
      { error: "Client revenue entries are only allowed on weekly goals — upper levels show an aggregated view" },
      { status: 400 },
    );
  }
  try {
    const body: CreateClientRevenuePayload = await req.json();
    if (!body.client_id) return NextResponse.json({ error: "client_id required" }, { status: 400 });
    const entry = await createClientRevenue({
      id: uuid(),
      goal_id: id,
      client_id: body.client_id,
      amount: body.amount,
      status: body.status,
      notes: body.notes,
    });
    return NextResponse.json(entry, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
