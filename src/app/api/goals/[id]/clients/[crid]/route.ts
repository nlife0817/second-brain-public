import { NextRequest, NextResponse } from "next/server";
import { updateClientRevenue, deleteClientRevenue } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import type { UpdateClientRevenuePayload } from "@/types";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ crid: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { crid } = await ctx.params;
  try {
    const body: UpdateClientRevenuePayload = await req.json();
    const updated = await updateClientRevenue(crid, body);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ crid: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { crid } = await ctx.params;
  const ok = await deleteClientRevenue(crid);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
