import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listInitiatives, createInitiative, linkInitiativeToMetric, linkInitiativeToDeal, linkInitiativeToClient } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";
import type { InitiativeStatus, PlanningInitiative } from "@/types/planning";

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") as InitiativeStatus | null;
  const dirParam = url.searchParams.get("direction_id");
  const type = url.searchParams.get("type") as PlanningInitiative["type"] | null;
  const includeArchived = url.searchParams.get("include_archived");
  const filter: Parameters<typeof listInitiatives>[0] = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (dirParam !== null) filter.directionId = dirParam === "null" ? null : dirParam;
  // 30-day auto-archive window unless explicitly disabled
  if (includeArchived !== "1") filter.includeArchivedAfterDays = 30;
  const rows = await listInitiatives(filter);
  return NextResponse.json(rows);
});

export const POST = withAuth(async (req: NextRequest, _ctx, user) => {
  const body = await req.json();
  if (!body?.title || !body?.type) {
    return NextResponse.json({ error: "title and type required" }, { status: 400 });
  }
  const row = await createInitiative(body);
  if (Array.isArray(body.linked_metric_ids)) {
    for (const mid of body.linked_metric_ids) await linkInitiativeToMetric(row.id, mid);
  }
  if (Array.isArray(body.linked_deal_ids)) {
    for (const did of body.linked_deal_ids) await linkInitiativeToDeal(row.id, did, body.blocks_stage ?? null);
  }
  if (Array.isArray(body.linked_client_ids)) {
    for (const cid of body.linked_client_ids) await linkInitiativeToClient(row.id, cid);
  }
  await logChange({
    actor_email: user.email,
    entity_type: "initiative",
    entity_id: row.id,
    action: "create",
    diff: { title: { from: null, to: row.title }, type: { from: null, to: row.type } },
  });
  return NextResponse.json(row, { status: 201 });
});
