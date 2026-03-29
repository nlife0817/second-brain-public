import { NextRequest, NextResponse } from "next/server";
import { getAllDevelopmentStages, createDevelopmentStage } from "@/lib/db";

export async function GET() {
  return NextResponse.json(getAllDevelopmentStages());
}

export async function POST(req: NextRequest) {
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
