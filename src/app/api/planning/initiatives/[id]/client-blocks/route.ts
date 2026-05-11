import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import {
  listInitiativeClientBlocks,
  linkInitiativeToClientBlock,
  unlinkInitiativeFromClientBlock,
} from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";

// P8: заменяет /api/planning/initiatives/[id]/deal-links.
//
// GET — список блокировок инициативы (по клиентам, опц. конкретным сделкам).
export const GET = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json(await listInitiativeClientBlocks(id));
});

// POST body: { client_id, deal_id?, blocks_stage? }. Upsert (благодаря
// uniq_initiative_client_block с NULLS NOT DISTINCT).
export const POST = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body?.client_id) return NextResponse.json({ error: "client_id required" }, { status: 400 });
  await linkInitiativeToClientBlock(
    id,
    body.client_id,
    body.deal_id ?? null,
    body.blocks_stage ?? null,
  );
  await logChange({
    actor_email: user.email,
    entity_type: "initiative",
    entity_id: id,
    action: "link_client_block",
    context: { client_id: body.client_id, deal_id: body.deal_id ?? null, blocks_stage: body.blocks_stage ?? null },
  });
  return NextResponse.json({ ok: true });
});

// DELETE ?client_id=…&deal_id=… (deal_id опц.)
export const DELETE = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const clientId = url.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "client_id required" }, { status: 400 });
  const dealId = url.searchParams.get("deal_id");
  await unlinkInitiativeFromClientBlock(id, clientId, dealId);
  await logChange({
    actor_email: user.email,
    entity_type: "initiative",
    entity_id: id,
    action: "unlink_client_block",
    context: { client_id: clientId, deal_id: dealId },
  });
  return NextResponse.json({ ok: true });
});
