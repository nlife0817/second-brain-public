import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getClientDeal, updateClientDeal, deleteClientDeal } from "@/lib/db";

// GET /api/clients/[id]/deals/[deal_id]
export const GET = withAuth(async (_req, ctx) => {
  const { deal_id } = await ctx.params;
  const row = await getClientDeal(deal_id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
});

// PATCH /api/clients/[id]/deals/[deal_id]
// Триггер lifecycle (pilot_started_at / pilot_planned_end_at / production_started_at)
// при смене status_id — внутри updateClientDeal.
export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const { deal_id } = await ctx.params;
  const body = await req.json();
  const row = await updateClientDeal(deal_id, body);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
});

// DELETE /api/clients/[id]/deals/[deal_id]
export const DELETE = withAuth(async (_req, ctx) => {
  const { deal_id } = await ctx.params;
  const ok = await deleteClientDeal(deal_id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
