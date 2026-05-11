import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare } from "@/lib/sql";
import type { PlanningDeal, PlanningInitiative } from "@/types/planning";

interface Row {
  deal_id: string;
  deal_title: string;
  deal_stage: string;
  client_id: string | null;
  min_monthly_amount: number | null;
  initiative_id: string;
  initiative_title: string;
  initiative_status: string;
  initiative_type: string;
  blocks_stage: string | null;
}

export const GET = withAuth(async () => {
  const rows = await prepare<Row>(`
    SELECT d.id AS deal_id, d.title AS deal_title, d.stage AS deal_stage,
           d.client_id, d.min_monthly_amount,
           i.id AS initiative_id, i.title AS initiative_title, i.status AS initiative_status,
           i.type AS initiative_type, l.blocks_stage
    FROM planning_initiative_deal_link l
    JOIN planning_deals d ON d.id = l.deal_id
    JOIN planning_initiatives i ON i.id = l.initiative_id
    WHERE i.status != 'done'
      AND i.type = 'client_blocker'
      AND d.stage IN ('lead','pilot')
    ORDER BY d.min_monthly_amount DESC NULLS LAST
  `).all();

  // Group by deal
  const byDeal = new Map<string, { deal: Partial<PlanningDeal>; blockers: Partial<PlanningInitiative>[] }>();
  for (const r of rows) {
    const key = r.deal_id;
    if (!byDeal.has(key)) {
      byDeal.set(key, {
        deal: {
          id: r.deal_id, title: r.deal_title, stage: r.deal_stage as PlanningDeal["stage"],
          client_id: r.client_id, min_monthly_amount: r.min_monthly_amount,
        },
        blockers: [],
      });
    }
    byDeal.get(key)!.blockers.push({
      id: r.initiative_id, title: r.initiative_title,
      status: r.initiative_status as PlanningInitiative["status"],
      type: r.initiative_type as PlanningInitiative["type"],
    });
  }
  return NextResponse.json(Array.from(byDeal.values()));
});
