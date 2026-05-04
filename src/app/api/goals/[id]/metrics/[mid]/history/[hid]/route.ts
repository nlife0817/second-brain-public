import { NextRequest, NextResponse } from "next/server";
import { updateMetricHistoryEntry, deleteMetricHistoryEntry } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ hid: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { hid } = await ctx.params;
  try {
    const body: { value?: number | null; note?: string } = await req.json();
    const updated = await updateMetricHistoryEntry(hid, body);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ hid: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { hid } = await ctx.params;
  const ok = await deleteMetricHistoryEntry(hid);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
