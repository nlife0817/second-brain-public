import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare } from "@/lib/sql";

export const DELETE = withAuth(async (_req, ctx) => {
  const { code } = await ctx.params;
  const res = await prepare("DELETE FROM planning_metric_units WHERE code = ?").run(code);
  return NextResponse.json({ ok: res.changes > 0 });
});
