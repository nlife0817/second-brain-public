import { NextRequest, NextResponse } from "next/server";
import { updateMetric, deleteMetric } from "@/lib/db";
import type { UpdateMetricPayload } from "@/types";
import { getAuthUser } from "@/lib/auth";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; mid: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { mid } = await ctx.params;
  try {
    const body: UpdateMetricPayload = await req.json();
    const updated = await updateMetric(mid, body);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; mid: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { mid } = await ctx.params;
  const ok = await deleteMetric(mid);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
