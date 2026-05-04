import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getMetricHistory, recordMetricSnapshot } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ mid: string }> }) {
  const { mid } = await ctx.params;
  const entries = await getMetricHistory(mid);
  return NextResponse.json(entries);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ mid: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { mid } = await ctx.params;
  try {
    const body: { value: number; note?: string } = await req.json();
    if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
      return NextResponse.json({ error: "value must be a finite number" }, { status: 400 });
    }
    const entry = await recordMetricSnapshot({ id: uuid(), metric_id: mid, value: body.value, note: body.note });
    return NextResponse.json(entry, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
