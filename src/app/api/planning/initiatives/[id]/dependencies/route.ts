import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listInitiativeDependencies, addDependency, removeDependency } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";

export const GET = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const rows = await listInitiativeDependencies(id);
  return NextResponse.json(rows);
});

export const POST = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body?.depends_on_initiative_id) {
    return NextResponse.json({ error: "depends_on_initiative_id required" }, { status: 400 });
  }
  await addDependency(id, body.depends_on_initiative_id);
  await logChange({
    actor_email: user.email,
    entity_type: "initiative_dependency",
    entity_id: id,
    action: "add",
    diff: { depends_on: { from: null, to: body.depends_on_initiative_id } },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
});

export const DELETE = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body?.depends_on_initiative_id) {
    return NextResponse.json({ error: "depends_on_initiative_id required" }, { status: 400 });
  }
  await removeDependency(id, body.depends_on_initiative_id);
  await logChange({
    actor_email: user.email,
    entity_type: "initiative_dependency",
    entity_id: id,
    action: "remove",
    diff: { depends_on: { from: body.depends_on_initiative_id, to: null } },
  });
  return NextResponse.json({ ok: true });
});
