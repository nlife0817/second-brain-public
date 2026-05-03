import { NextRequest, NextResponse } from "next/server";
import { updateGoalAxis, deleteGoalAxis, getGoalAxisById } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import type { UpdateGoalAxisPayload } from "@/types";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const body: UpdateGoalAxisPayload = await req.json();
    const axis = await updateGoalAxis(id, body);
    if (!axis) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(axis);
  } catch (e) {
    console.error("PATCH /api/goal-axes/[id] failed", e);
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const result = await deleteGoalAxis(id);
  if (!result.ok) {
    if (result.reason === "system") return NextResponse.json({ error: "Cannot delete system axis" }, { status: 400 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const axis = await getGoalAxisById(id);
  if (!axis) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(axis);
}
