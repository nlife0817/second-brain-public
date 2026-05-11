import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import {
  getInitiative,
  updateInitiative,
  deleteInitiative,
  listInitiativeMetricLinks,
  listInitiativeDealLinks,
  listInitiativeClientLinks,
  listInitiativeDependencies,
  linkInitiativeToMetric,
  unlinkInitiativeFromMetric,
  linkInitiativeToDeal,
  unlinkInitiativeFromDeal,
  linkInitiativeToClient,
  unlinkInitiativeFromClient,
} from "@/lib/db";
import { logChange, buildDiff, suggestReplanReason } from "@/lib/planning-changelog";

export const GET = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const row = await getInitiative(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [metrics, deals, clients, deps] = await Promise.all([
    listInitiativeMetricLinks(id),
    listInitiativeDealLinks(id),
    listInitiativeClientLinks(id),
    listInitiativeDependencies(id),
  ]);
  return NextResponse.json({ ...row, linked_metrics: metrics, linked_deals: deals, linked_clients: clients, dependencies: deps });
});

export const PATCH = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const before = await getInitiative(id);
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json();

  // Link updates (optional in body)
  if (Array.isArray(body.linked_metric_ids)) {
    const current = (await listInitiativeMetricLinks(id)).map((l) => l.metric_id);
    const next = body.linked_metric_ids as string[];
    for (const mid of next.filter((m) => !current.includes(m))) await linkInitiativeToMetric(id, mid);
    for (const mid of current.filter((m) => !next.includes(m))) await unlinkInitiativeFromMetric(id, mid);
    delete body.linked_metric_ids;
  }
  if (Array.isArray(body.linked_deal_ids)) {
    const current = (await listInitiativeDealLinks(id)).map((l) => l.deal_id);
    const next = body.linked_deal_ids as string[];
    for (const did of next.filter((d) => !current.includes(d))) await linkInitiativeToDeal(id, did, body.blocks_stage ?? null);
    for (const did of current.filter((d) => !next.includes(d))) await unlinkInitiativeFromDeal(id, did);
    delete body.linked_deal_ids;
    delete body.blocks_stage;
  }
  if (Array.isArray(body.linked_client_ids)) {
    const current = (await listInitiativeClientLinks(id)).map((l) => l.client_id);
    const next = body.linked_client_ids as string[];
    for (const cid of next.filter((c) => !current.includes(c))) await linkInitiativeToClient(id, cid);
    for (const cid of current.filter((c) => !next.includes(c))) await unlinkInitiativeFromClient(id, cid);
    delete body.linked_client_ids;
  }

  const userReplanReason = body.replan_reason;
  delete body.replan_reason;
  // Track done_at automatically on status transition to "done"
  if (body.status === "done" && before.status !== "done") body.done_at = new Date().toISOString();

  const after = await updateInitiative(id, body);
  if (!after) return NextResponse.json({ error: "update failed" }, { status: 500 });

  const diff = buildDiff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
  const suggested = suggestReplanReason(diff);
  const replan = userReplanReason ?? (suggested ? { code: suggested } : null);

  await logChange({
    actor_email: user.email,
    entity_type: "initiative",
    entity_id: id,
    action: "update",
    diff,
    replan_reason: replan,
  });
  return NextResponse.json(after);
});

export const DELETE = withAuth(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  await deleteInitiative(id);
  await logChange({ actor_email: user.email, entity_type: "initiative", entity_id: id, action: "delete" });
  return NextResponse.json({ ok: true });
});
