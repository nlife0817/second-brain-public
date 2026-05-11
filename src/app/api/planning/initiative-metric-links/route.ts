import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare } from "@/lib/sql";
import type { PlanningInitiativeMetricLink } from "@/types/planning";

// GET /api/planning/initiative-metric-links
// Возвращает все строки planning_initiative_metric_link одним запросом.
// Создан, чтобы убрать N-fetch анти-паттерн в InitiativeColumn, где раньше
// дёргался /api/planning/initiatives/[id] на каждую инициативу ради
// получения linked_metrics.
export const GET = withAuth(async () => {
  const rows = await prepare<PlanningInitiativeMetricLink>(
    "SELECT initiative_id, metric_id FROM planning_initiative_metric_link",
  ).all();
  return NextResponse.json(rows);
});
