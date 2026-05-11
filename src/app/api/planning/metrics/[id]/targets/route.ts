import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listMetricTargets, bulkUpsertMetricTargets, getMetric } from "@/lib/db";
import { logChange, classifyTargetChange } from "@/lib/planning-changelog";
import type { UpsertMetricTargetInput, ReplanReason } from "@/types/planning";

export const GET = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const rows = await listMetricTargets(id);
  return NextResponse.json(rows);
});

export const PATCH = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const metric = await getMetric(id);
  if (!metric) return NextResponse.json({ error: "metric not found" }, { status: 404 });
  const body = await req.json();
  const items: UpsertMetricTargetInput[] = Array.isArray(body?.items) ? body.items : [];
  const explicit: ReplanReason | null = body?.replan_reason ?? null;
  if (items.length === 0) return NextResponse.json({ error: "items required" }, { status: 400 });

  // Auto-classify minor adjustments
  const existing = await listMetricTargets(id);
  const existingByPeriod = new Map(existing.map((t) => [t.period_id, Number(t.target_value)]));
  let allMinor = true;
  for (const it of items) {
    const old = existingByPeriod.get(it.period_id);
    const cls = await classifyTargetChange(old ?? null, Number(it.target_value));
    if (!cls.minor) { allMinor = false; break; }
  }

  const updated = await bulkUpsertMetricTargets(items.map((it) => ({ ...it, metric_id: id })));

  const replan: ReplanReason | null = explicit ?? (allMinor ? { code: "minor_adjustment" } : null);
  await logChange({
    actor_email: user.email,
    entity_type: "metric_target",
    entity_id: id,
    action: "bulk_upsert",
    diff: { count: { from: existing.length, to: updated.length } },
    replan_reason: replan,
    context: { items_changed: items.length },
  });

  return NextResponse.json(updated);
});
