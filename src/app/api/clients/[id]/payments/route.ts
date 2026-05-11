import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listAllClientPayments } from "@/lib/db";

// GET /api/clients/[id]/payments — все платежи по всем сделкам клиента (для
// таба «Платежи» в карточке клиента). Включает deal_title для каждой строки.
export const GET = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const rows = await listAllClientPayments(id);
  return NextResponse.json(rows);
});
