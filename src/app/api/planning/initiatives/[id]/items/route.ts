import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { linkItemToInitiative, unlinkItemFromInitiative, listInitiativeItems } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";

// P3: M:N инициатива ↔ задача. Источник правды — planning_item_initiative_link.

export const GET = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const items = await listInitiativeItems(id);
  return NextResponse.json(items);
});

export const POST = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as { item_ids?: string[] };
  const ids = Array.isArray(body.item_ids) ? body.item_ids : [];
  if (ids.length === 0) return NextResponse.json({ error: "item_ids required" }, { status: 400 });
  for (const itemId of ids) await linkItemToInitiative(itemId, id);
  await logChange({
    actor_email: user.email,
    entity_type: "initiative",
    entity_id: id,
    action: "update",
    diff: { linked_items: { from: null, to: ids } },
    context: { kind: "link_items" },
  });
  return NextResponse.json({ ok: true, linked: ids.length });
});

export const DELETE = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const itemId = url.searchParams.get("item_id");
  if (!itemId) return NextResponse.json({ error: "item_id required" }, { status: 400 });
  await unlinkItemFromInitiative(itemId, id);
  await logChange({
    actor_email: user.email,
    entity_type: "initiative",
    entity_id: id,
    action: "update",
    diff: { linked_items: { from: itemId, to: null } },
    context: { kind: "unlink_item" },
  });
  return NextResponse.json({ ok: true });
});
