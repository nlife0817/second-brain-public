import { NextRequest, NextResponse } from "next/server";
import { getAllDevelopmentParticipants, createDevelopmentParticipant } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
  return NextResponse.json(getAllDevelopmentParticipants());
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
    const participant = createDevelopmentParticipant(name);
    return NextResponse.json(participant, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create" }, { status: 500 });
  }
}
