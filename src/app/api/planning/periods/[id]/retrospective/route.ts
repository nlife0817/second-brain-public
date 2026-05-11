import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getPeriod, updateRetrospective } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";
import type { PlanningPeriodRetrospective } from "@/types/planning";

export const PATCH = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const before = await getPeriod(id);
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json()) as PlanningPeriodRetrospective;
  const row = await updateRetrospective(id, body);
  await logChange({
    actor_email: user.email,
    entity_type: "period",
    entity_id: id,
    action: "update_retrospective",
    diff: { retrospective: { from: before.retrospective, to: row?.retrospective ?? null } },
  });
  return NextResponse.json(row);
});
