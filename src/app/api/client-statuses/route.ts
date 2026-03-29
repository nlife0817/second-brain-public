import { NextRequest, NextResponse } from "next/server";
import { getAllClientStatuses, createClientStatus } from "@/lib/db";

export async function GET() {
  return NextResponse.json(getAllClientStatuses());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, color } = body;
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const status = createClientStatus({
      id: crypto.randomUUID(),
      name,
      color: color || "#6b7280",
    });
    return NextResponse.json(status, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: "Failed to create status" }, { status: 500 });
  }
}
