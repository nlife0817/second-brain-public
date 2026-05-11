import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listItemInitiativeLinks, linkItemToInitiative, unlinkItemFromInitiative } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";

// M:N инициатива ↔ задача со стороны задачи. Используется в TaskDetailContent
// (раздел «Привязана к инициативам»). Под капотом — planning_item_initiative_link.

export const GET = withAuth(async (_req, ctx) => {
  const { itemId } = await ctx.params;
  const links = await listItemInitiativeLinks(itemId);
  return NextResponse.json(links.map((l) => l.initiative_id));
});

export const POST = withAuth(async (req: NextRequest, ctx, user) => {
  const { itemId } = await ctx.params;
  const body = (await req.json()) as { initiative_id?: string };
  const initiativeId = body.initiative_id;
  if (!initiativeId) {
    return NextResponse.json({ error: "initiative_id required" }, { status: 400 });
  }
  await linkItemToInitiative(itemId, initiativeId);
  await logChange({
    actor_email: user.email,
    entity_type: "initiative",
    entity_id: initiativeId,
    action: "update",
    diff: { linked_items: { from: null, to: [itemId] } },
    context: { kind: "link_items" },
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth(async (req: NextRequest, ctx, user) => {
  const { itemId } = await ctx.params;
  const url = new URL(req.url);
  const initiativeId = url.searchParams.get("initiative_id");
  if (!initiativeId) {
    return NextResponse.json({ error: "initiative_id required" }, { status: 400 });
  }
  await unlinkItemFromInitiative(itemId, initiativeId);
  await logChange({
    actor_email: user.email,
    entity_type: "initiative",
    entity_id: initiativeId,
    action: "update",
    diff: { linked_items: { from: itemId, to: null } },
    context: { kind: "unlink_item" },
  });
  return NextResponse.json({ ok: true });
});
