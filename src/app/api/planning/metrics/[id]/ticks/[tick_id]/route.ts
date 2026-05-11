import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { deleteMetricTick } from "@/lib/db";

export const DELETE = withAuth(async (_req: NextRequest, ctx) => {
  const { id, tick_id } = (await ctx.params) as { id: string; tick_id: string };
  const ok = await deleteMetricTick(id, tick_id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
