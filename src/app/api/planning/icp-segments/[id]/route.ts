import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { updateIcpSegment } from "@/lib/db";
import { prepare } from "@/lib/sql";

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null) as { title?: string; archived?: boolean; position?: number } | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });
  const row = await updateIcpSegment(id, body);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
});

export const DELETE = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const res = await prepare("DELETE FROM planning_icp_segments WHERE id = ?").run(id);
  return NextResponse.json({ ok: res.changes > 0 });
});
