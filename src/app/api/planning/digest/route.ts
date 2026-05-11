import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare } from "@/lib/sql";
import { listMetrics, listMetricTargets, listInitiatives, listChangeLog, getPlanningSettings, listDeals } from "@/lib/db";
import type { Item } from "@/types";

export const GET = withAuth(async () => {
  const settings = await getPlanningSettings();
  const initiatives = await listInitiatives({ includeArchivedAfterDays: 30 });
  const metrics = await listMetrics();
  const metricsWithTargets = await Promise.all(metrics.map(async (m) => ({
    metric: m,
    targets: await listMetricTargets(m.id),
  })));

  // Done in last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const doneItems = await prepare<Item>(
    "SELECT * FROM items WHERE type = 'task' AND status = 'done' AND updated_at >= ? ORDER BY updated_at DESC LIMIT 100"
  ).all(sevenDaysAgo);

  const doneInitiatives = initiatives.filter((i) => i.status === "done" && i.done_at && i.done_at >= sevenDaysAgo);
  const atRisk = initiatives.filter((i) => i.status === "in_progress");
  // Early warning: simple heuristic using settings.early_warning_weeks (defer detailed period join to UI)
  const earlyWarning = initiatives.filter((i) => i.status !== "done");

  const recentChanges = await listChangeLog({}, 20, 0);
  const blockedDeals = (await listDeals({ stage: "pilot" })).concat(await listDeals({ stage: "lead" }));

  return NextResponse.json({
    settings,
    metrics: metricsWithTargets,
    done_items: doneItems,
    done_initiatives: doneInitiatives,
    at_risk: atRisk,
    early_warning: earlyWarning,
    recent_changes: recentChanges,
    blocked_deals: blockedDeals.slice(0, 10),
  });
});
