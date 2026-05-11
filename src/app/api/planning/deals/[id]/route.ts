import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getDeal, updateDeal, deleteDeal, getPlanningSettings } from "@/lib/db";
import { logChange, buildDiff } from "@/lib/planning-changelog";
import type { UpdateDealInput } from "@/types/planning";

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export const GET = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const row = await getDeal(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
});

export const PATCH = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const before = await getDeal(id);
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json()) as UpdateDealInput;
  const now = new Date();
  const stageChanged = body.stage && body.stage !== before.stage;

  // Stage transition auto-fill (concept §6.7.5)
  if (stageChanged) {
    body.stage_changed_at = now.toISOString();
    if (body.stage === "pilot" && !before.pilot_started_at) {
      body.pilot_started_at = now.toISOString();
      const days = before.pilot_default_duration_days
        ?? (await getPlanningSettings()).pilot_default_duration_days
        ?? 60;
      body.pilot_planned_end_at = addDays(now, days).toISOString();
    }
    if (body.stage === "production" && !before.production_started_at) {
      body.production_started_at = now.toISOString();
    }
  }

  const after = await updateDeal(id, body);
  if (!after) return NextResponse.json({ error: "update failed" }, { status: 500 });
  await logChange({
    actor_email: user.email,
    entity_type: "deal",
    entity_id: id,
    action: "update",
    diff: buildDiff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>),
  });
  return NextResponse.json(after);
});

export const DELETE = withAuth(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  await deleteDeal(id);
  await logChange({ actor_email: user.email, entity_type: "deal", entity_id: id, action: "delete" });
  return NextResponse.json({ ok: true });
});

