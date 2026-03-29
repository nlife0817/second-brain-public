import { NextRequest, NextResponse } from "next/server";
import { getAllDevelopmentParticipants, createDevelopmentParticipant } from "@/lib/db";

export async function GET() {
  return NextResponse.json(getAllDevelopmentParticipants());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name } = body;
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    const participant = createDevelopmentParticipant(name);
    return NextResponse.json(participant, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create" }, { status: 500 });
  }
}
