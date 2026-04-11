import { NextRequest, NextResponse } from "next/server";
import { getAllDevelopmentStages, createDevelopmentStage } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
  return NextResponse.json(getAllDevelopmentStages());
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req.headers);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const { name } = body;
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    const stage = createDevelopmentStage({ id: crypto.randomUUID(), name });
    return NextResponse.json(stage, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create" }, { status: 500 });
  }
}
