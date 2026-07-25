import { NextRequest, NextResponse } from "next/server";
import { getAllClientStatuses, createClientStatus } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
  return NextResponse.json(await getAllClientStatuses());
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const { name, color } = body;
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const status = await createClientStatus({
      id: crypto.randomUUID(),
      name,
      color: color || "#6b7280",
    });
    return NextResponse.json(status, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create status" }, { status: 500 });
  }
}
