import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listMetrics, createMetric } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";
import { initPlanningYear } from "@/lib/planning-year-init";

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url);
  const direction = url.searchParams.get("direction_id");
  const rows = await listMetrics(direction === null ? undefined : direction === "null" ? null : direction);
  return NextResponse.json(rows);
});

export const POST = withAuth(async (req: NextRequest, _ctx, user) => {
  const body = await req.json();
  if (!body?.title || !body?.type) {
    return NextResponse.json({ error: "title and type are required" }, { status: 400 });
  }
  const row = await createMetric(body);

  // Silent ensure: периоды текущего и следующего года для направления метрики.
  // Защита от случая, когда direction создан до миграции 0029 (без auto-init).
  if (row.direction_id) {
    const currentYear = new Date().getFullYear();
    await Promise.all([
      initPlanningYear({ direction_id: row.direction_id, year: currentYear }).catch(() => null),
      initPlanningYear({ direction_id: row.direction_id, year: currentYear + 1 }).catch(() => null),
    ]);
  }

  await logChange({
    actor_email: user.email,
    entity_type: "metric",
    entity_id: row.id,
    action: "create",
    diff: { title: { from: null, to: row.title }, type: { from: null, to: row.type } },
  });
  return NextResponse.json(row, { status: 201 });
});
