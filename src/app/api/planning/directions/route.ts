import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listDirections, createDirection } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";
import { initPlanningYear } from "@/lib/planning-year-init";

export const GET = withAuth(async () => {
  const rows = await listDirections();
  return NextResponse.json(rows);
});

export const POST = withAuth(async (req: NextRequest, _ctx, user) => {
  const body = await req.json();
  if (!body?.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const row = await createDirection({
    title: body.title,
    year_focus: body.year_focus ?? null,
    position: typeof body.position === "number" ? body.position : 0,
  });

  // Silent auto-init: периоды текущего и следующего года создаются молча.
  // Убирает «Инициализировать год» как ручной шаг (см. PLAN_PLANNING_REWORK §1 P0).
  const currentYear = new Date().getFullYear();
  await Promise.all([
    initPlanningYear({ direction_id: row.id, year: currentYear }).catch(() => null),
    initPlanningYear({ direction_id: row.id, year: currentYear + 1 }).catch(() => null),
  ]);

  await logChange({
    actor_email: user.email,
    entity_type: "direction",
    entity_id: row.id,
    action: "create",
    diff: { title: { from: null, to: row.title } },
  });
  return NextResponse.json(row, { status: 201 });
});
