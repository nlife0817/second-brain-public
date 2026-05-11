import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import {
  listClientDealPayments,
  addClientDealPayment,
  updateClientDealPayment,
  deleteClientDealPayment,
} from "@/lib/db";

// GET /api/clients/[id]/deals/[deal_id]/payments
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { deal_id } = await ctx.params;
  const url = new URL(req.url);
  const filter: Parameters<typeof listClientDealPayments>[1] = {};
  const from = url.searchParams.get("from"); if (from) filter.from = from;
  const to = url.searchParams.get("to");     if (to)   filter.to = to;
  const status = url.searchParams.get("status");
  if (status === "expected" || status === "confirmed") filter.status = status;
  const rows = await listClientDealPayments(deal_id, filter);
  return NextResponse.json(rows);
});

// POST /api/clients/[id]/deals/[deal_id]/payments
// body: { paid_at, amount, note?, status? }
export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { deal_id } = await ctx.params;
  const body = await req.json();
  if (!body?.paid_at || typeof body?.amount !== "number") {
    return NextResponse.json({ error: "paid_at and amount required" }, { status: 400 });
  }
  const row = await addClientDealPayment({
    deal_id,
    paid_at: body.paid_at,
    amount: body.amount,
    note: body.note ?? null,
    status: body.status ?? "expected",
  });
  return NextResponse.json(row, { status: 201 });
});

// PATCH /api/clients/[id]/deals/[deal_id]/payments?payment_id=...
export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const { deal_id: _ } = await ctx.params;
  void _;
  const url = new URL(req.url);
  const paymentId = url.searchParams.get("payment_id");
  if (!paymentId) return NextResponse.json({ error: "payment_id required" }, { status: 400 });
  const body = await req.json();
  const row = await updateClientDealPayment(paymentId, body);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
});

// DELETE /api/clients/[id]/deals/[deal_id]/payments?payment_id=...
export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  const { deal_id: _ } = await ctx.params;
  void _;
  const url = new URL(req.url);
  const paymentId = url.searchParams.get("payment_id");
  if (!paymentId) return NextResponse.json({ error: "payment_id required" }, { status: 400 });
  const ok = await deleteClientDealPayment(paymentId);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
