import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare } from "@/lib/sql";

// GET /api/clients/deals — все сделки всех клиентов с client_name + status_name.
// Используется для глобальных селекторов (TaskPlanningSection, InitiativeDetailSheet
// блокировка клиентов через выбор сделки).
export const GET = withAuth(async () => {
  const rows = await prepare<{
    id: string; client_id: string; client_name: string; title: string;
    status_id: string | null; status_name: string | null;
    pilot_started_at: string | null; pilot_planned_end_at: string | null;
    production_started_at: string | null;
    min_monthly_amount: string | null;
  }>(`
    SELECT d.id, d.client_id, c.name AS client_name, d.title,
           d.status_id, s.name AS status_name,
           d.pilot_started_at, d.pilot_planned_end_at, d.production_started_at,
           d.min_monthly_amount::text AS min_monthly_amount
    FROM client_deals d
    JOIN clients c ON c.id = d.client_id
    LEFT JOIN client_statuses s ON s.id = d.status_id
    ORDER BY c.name ASC, d.position ASC, d.created_at ASC
  `).all();
  return NextResponse.json(rows.map((r) => ({
    ...r,
    min_monthly_amount: r.min_monthly_amount == null ? null : Number(r.min_monthly_amount),
  })));
});
