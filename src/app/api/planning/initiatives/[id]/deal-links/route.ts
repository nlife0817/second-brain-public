import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { linkInitiativeToDeal, unlinkInitiativeFromDeal } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";
import type { DealBlockingStage } from "@/types/planning";

// POST /api/planning/initiatives/[id]/deal-links
//   body: { deal_id: string, blocks_stage: 'pilot'|'production'|null }
// Создаёт или обновляет связь сделка↔инициатива с указанным blocks_stage.
// Используется DealLinksEditor (см. InitiativeDetailSheet) для client_blocker.
export const POST = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body?.deal_id) {
    return NextResponse.json({ error: "deal_id required" }, { status: 400 });
  }
  const stage: DealBlockingStage | null =
    body.blocks_stage === "pilot" || body.blocks_stage === "production"
      ? body.blocks_stage
      : null;
  await linkInitiativeToDeal(id, body.deal_id, stage);
  await logChange({
    actor_email: user.email,
    entity_type: "initiative",
    entity_id: id,
    action: "link_deal",
    diff: { deal_id: { from: null, to: body.deal_id }, blocks_stage: { from: null, to: stage } },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
});

export const DELETE = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const dealId = url.searchParams.get("deal_id");
  if (!dealId) {
    return NextResponse.json({ error: "deal_id query param required" }, { status: 400 });
  }
  await unlinkInitiativeFromDeal(id, dealId);
  await logChange({
    actor_email: user.email,
    entity_type: "initiative",
    entity_id: id,
    action: "unlink_deal",
    diff: { deal_id: { from: dealId, to: null } },
  });
  return NextResponse.json({ ok: true });
});
