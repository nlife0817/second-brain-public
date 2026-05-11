import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listDeals, createDeal } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";
import type { DealStage } from "@/types/planning";

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url);
  const stage = url.searchParams.get("stage") as DealStage | null;
  const clientId = url.searchParams.get("client_id");
  const rows = await listDeals({
    ...(stage ? { stage } : {}),
    ...(clientId ? { clientId } : {}),
  });
  return NextResponse.json(rows);
});

export const POST = withAuth(async (req: NextRequest, _ctx, user) => {
  const body = await req.json();
  if (!body?.title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const row = await createDeal(body);
  await logChange({
    actor_email: user.email,
    entity_type: "deal",
    entity_id: row.id,
    action: "create",
    diff: { title: { from: null, to: row.title }, stage: { from: null, to: row.stage } },
  });
  return NextResponse.json(row, { status: 201 });
});
