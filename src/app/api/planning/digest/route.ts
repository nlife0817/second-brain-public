import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare } from "@/lib/sql";
import { listMetrics, listMetricTargets, listInitiatives, listChangeLog, getPlanningSettings, listDeals, listMetricTicks } from "@/lib/db";
import type { Item } from "@/types";

export const GET = withAuth(async () => {
  const settings = await getPlanningSettings();
  const initiatives = await listInitiatives({ includeArchivedAfterDays: 30 });
  const metrics = await listMetrics();
  const metricsWithTargets = await Promise.all(metrics.map(async (m) => {
    const targets = await listMetricTargets(m.id);
    const ticks = await listMetricTicks(m.id, { limit: 20 });
    return { metric: m, targets, recent_ticks: ticks };
  }));

  // Done in last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const doneItems = await prepare<Item>(
    "SELECT * FROM items WHERE type = 'task' AND status = 'done' AND updated_at >= ? ORDER BY updated_at DESC LIMIT 100"
  ).all(sevenDaysAgo);

  const doneInitiatives = initiatives.filter((i) => i.status === "done" && i.done_at && i.done_at >= sevenDaysAgo);
  const atRisk = initiatives.filter((i) => i.status === "in_progress");
  const earlyWarning = initiatives.filter((i) => i.status !== "done");

  const recentChanges = await listChangeLog({}, 20, 0);
  const blockedDeals = (await listDeals({ stage: "pilot" })).concat(await listDeals({ stage: "lead" }));

  // Strategy / Support ratio (concept §6.6)
  // Strategy hours = SUM(estimate_hours) for non-support active initiatives
  // Support hours  = SUM(estimate_hours) for support active initiatives
  const activeInits = initiatives.filter((i) => i.status !== "done" && i.status !== "killed");
  const strategyHours = activeInits
    .filter((i) => i.type !== "support")
    .reduce((s, i) => s + (Number(i.estimate_hours) || 0), 0);
  const supportHours = activeInits
    .filter((i) => i.type === "support")
    .reduce((s, i) => s + (Number(i.estimate_hours) || 0), 0);
  const totalHours = strategyHours + supportHours;
  const strategyRatio = totalHours > 0 ? strategyHours / totalHours : 0;
  const targetRatio = Number(settings.strategy_support_ratio ?? 0.7);
  const ratioWarning = totalHours > 0 && (strategyRatio < 0.6 || strategyRatio > 0.8);

  // Overdue pilots (concept §6.7.5)
  const overduePilots = await prepare<{ id: string; title: string; pilot_planned_end_at: string }>(`
    SELECT id, title, pilot_planned_end_at FROM planning_deals
    WHERE stage = 'pilot' AND pilot_ended_at IS NULL
      AND pilot_planned_end_at IS NOT NULL AND pilot_planned_end_at < now()
    ORDER BY pilot_planned_end_at ASC LIMIT 10
  `).all();

  // Kill criteria triggers — count of initiatives with non-empty kill_criteria
  // currently flagged via notifications_log within the last 7 days.
  const killAlerts = await prepare<{ count: number }>(`
    SELECT COUNT(*)::int AS count
    FROM notifications_log
    WHERE type = 'planning_kill_criteria' AND sent_at >= ?
  `).get(sevenDaysAgo);

  return NextResponse.json({
    settings,
    metrics: metricsWithTargets,
    done_items: doneItems,
    done_initiatives: doneInitiatives,
    at_risk: atRisk,
    early_warning: earlyWarning,
    recent_changes: recentChanges,
    blocked_deals: blockedDeals.slice(0, 10),
    strategy_support: {
      strategy_hours: strategyHours,
      support_hours: supportHours,
      ratio: strategyRatio,
      target_ratio: targetRatio,
      warning: ratioWarning,
    },
    overdue_pilots: overduePilots,
    kill_criteria_count: Number(killAlerts?.count ?? 0),
  });
});
