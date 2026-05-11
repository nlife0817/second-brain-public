import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { initPlanningYear } from "@/lib/planning-year-init";
import { logChange } from "@/lib/planning-changelog";

export const POST = withAuth(async (req: NextRequest, _ctx, user) => {
  const body = await req.json().catch(() => null);
  const year = Number(body?.year ?? new Date().getFullYear());
  const directionId: string | null = body?.direction_id ?? null;

  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "year out of range" }, { status: 400 });
  }

  const result = await initPlanningYear({ direction_id: directionId, year });

  await logChange({
    actor_email: user.email,
    entity_type: "period",
    entity_id: directionId ?? "global",
    action: "init_year",
    diff: {
      year: { from: null, to: year },
      created: { from: 0, to: result.created.length },
      skipped: { from: 0, to: result.skipped },
    },
    context: { direction_id: directionId },
  });

  return NextResponse.json(result);
});
