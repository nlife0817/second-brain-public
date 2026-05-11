import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listDealPayments, addDealPayment, updateDealPayment, deleteDealPayment } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";
import type { DealPaymentStatus } from "@/types/planning";

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") as DealPaymentStatus | null;
  const rows = await listDealPayments(id, status ? { status } : undefined);
  return NextResponse.json(rows);
});

export const POST = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body?.paid_at || typeof body?.amount !== "number") {
    return NextResponse.json({ error: "paid_at and amount required" }, { status: 400 });
  }
  const row = await addDealPayment({
    deal_id: id,
    paid_at: body.paid_at,
    amount: Number(body.amount),
    note: body.note ?? null,
    status: body.status ?? "expected",
  });
  await logChange({
    actor_email: user.email,
    entity_type: "deal_payment",
    entity_id: row.id,
    action: "create",
    diff: { amount: { from: null, to: row.amount }, status: { from: null, to: row.status } },
    context: { deal_id: id },
  });
  return NextResponse.json(row, { status: 201 });
});

export const PATCH = withAuth(async (req: NextRequest, _ctx, user) => {
  const body = await req.json();
  if (!body?.id) return NextResponse.json({ error: "payment id required" }, { status: 400 });
  const row = await updateDealPayment(body.id, body);
  await logChange({
    actor_email: user.email,
    entity_type: "deal_payment",
    entity_id: body.id,
    action: "update",
    diff: { amount: { from: null, to: row?.amount }, status: { from: null, to: row?.status } },
  });
  return NextResponse.json(row);
});

export const DELETE = withAuth(async (req: NextRequest, _ctx, user) => {
  const body = await req.json();
  if (!body?.id) return NextResponse.json({ error: "payment id required" }, { status: 400 });
  await deleteDealPayment(body.id);
  await logChange({ actor_email: user.email, entity_type: "deal_payment", entity_id: body.id, action: "delete" });
  return NextResponse.json({ ok: true });
});
