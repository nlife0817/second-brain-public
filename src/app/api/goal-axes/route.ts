import { NextRequest, NextResponse } from "next/server";
import { getGoalAxes, createGoalAxis } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import type { CreateGoalAxisPayload } from "@/types";

export async function GET() {
  const axes = await getGoalAxes();
  return NextResponse.json(axes);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || `axis_${Date.now()}`;
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body: CreateGoalAxisPayload = await req.json();
    if (!body.name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    const id = body.id?.trim() || slugify(body.name);
    const axis = await createGoalAxis({ ...body, id });
    return NextResponse.json(axis, { status: 201 });
  } catch (e) {
    console.error("POST /api/goal-axes failed", e);
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
