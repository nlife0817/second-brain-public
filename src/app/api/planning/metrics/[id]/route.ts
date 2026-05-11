import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getMetric, updateMetric, deleteMetric } from "@/lib/db";
import { logChange, buildDiff } from "@/lib/planning-changelog";

export const GET = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const row = await getMetric(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
});

export const PATCH = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const before = await getMetric(id);
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json();
  const after = await updateMetric(id, body);
  if (!after) return NextResponse.json({ error: "update failed" }, { status: 500 });
  await logChange({
    actor_email: user.email,
    entity_type: "metric",
    entity_id: id,
    action: "update",
    diff: buildDiff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>),
  });
  return NextResponse.json(after);
});

export const DELETE = withAuth(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  await deleteMetric(id);
  await logChange({ actor_email: user.email, entity_type: "metric", entity_id: id, action: "delete" });
  return NextResponse.json({ ok: true });
});
