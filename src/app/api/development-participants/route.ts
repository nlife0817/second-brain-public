import { NextRequest, NextResponse } from "next/server";
import { getAllDevelopmentParticipants, createDevelopmentParticipant } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
  return NextResponse.json(await getAllDevelopmentParticipants());
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const { name, role, weekly_hours_default } = body;
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    if (role && !["developer", "other"].includes(role)) {
      return NextResponse.json({ error: "Invalid role (only developer/other allowed at creation)" }, { status: 400 });
    }
    const participant = await createDevelopmentParticipant(name, {
      role: role as "developer" | "other" | undefined,
      weekly_hours_default,
    });
    return NextResponse.json(participant, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create" }, { status: 500 });
  }
}
