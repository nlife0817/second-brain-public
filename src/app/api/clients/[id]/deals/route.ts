import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listClientDeals, createClientDeal } from "@/lib/db";

// GET /api/clients/[id]/deals — список сделок клиента.
export const GET = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const rows = await listClientDeals({ clientId: id });
  return NextResponse.json(rows);
});

// POST /api/clients/[id]/deals — создать сделку.
// body: { title?, status_id?, pilot_default_duration_days?, min_monthly_amount?, expected_actual_amount?, description?, position? }
export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const row = await createClientDeal({
    client_id: id,
    title: body.title,
    status_id: body.status_id ?? null,
    pilot_default_duration_days: body.pilot_default_duration_days,
    min_monthly_amount: body.min_monthly_amount ?? null,
    expected_actual_amount: body.expected_actual_amount ?? null,
    description: body.description ?? null,
    position: body.position,
  });
  return NextResponse.json(row, { status: 201 });
});
