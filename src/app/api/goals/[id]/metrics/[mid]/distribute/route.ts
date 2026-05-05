import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import {
  getAllGoals, getMetricsForGoal, getMetricsForGoals,
} from "@/lib/db";
import { transaction } from "@/lib/sql";
import { getAuthUser } from "@/lib/auth";
import type { GoalLevel, GoalMetric } from "@/types";

const NEXT_LEVEL: Record<GoalLevel, GoalLevel | null> = {
  year: "quarter",
  quarter: "month",
  month: "week",
  week: null,
};

interface DistributeBody {
  children: { goal_id: string; target_value: number | null }[];
}

/**
 * Distribute a parent KR's plan across the next-level child goals. Creates a
 * linked KR (parent_metric_id = mid) on each requested child goal with the
 * supplied target_value. If a linked KR already exists on a child, its
 * target_value is updated in place.
 *
 * The kind/unit/direction/start_value/tasks_category_ids are inherited from
 * the parent KR — only target_value is set per child.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; mid: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, mid } = await ctx.params;

  const parentMetrics = await getMetricsForGoal(id);
  const parentMetric = parentMetrics.find((m) => m.id === mid);
  if (!parentMetric) return NextResponse.json({ error: "Parent KR not found" }, { status: 404 });

  // tasks-KR are auto-aggregated from due_date+category — distributing
  // a target_value plan does not apply (progress is done/total). Cascade of
  // tasks_category_ids already happens at decomposition time via parent_metric_id.
  if (parentMetric.kind === "tasks") {
    return NextResponse.json(
      { error: "tasks KR cannot be distributed — categories cascade automatically at decomposition" },
      { status: 400 },
    );
  }

  const allGoals = await getAllGoals();
  const parentGoal = allGoals.find((g) => g.id === id);
  if (!parentGoal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });

  const childLevel = NEXT_LEVEL[parentGoal.level];
  if (!childLevel) {
    return NextResponse.json({ error: "Goal has no decomposable level" }, { status: 400 });
  }

  const directChildren = allGoals.filter((g) => g.parent_id === id && g.level === childLevel);
  const childrenById = new Map(directChildren.map((g) => [g.id, g]));

  let body: DistributeBody;
  try {
    body = await req.json() as DistributeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!Array.isArray(body.children)) {
    return NextResponse.json({ error: "children: array required" }, { status: 400 });
  }
  for (const c of body.children) {
    if (!c.goal_id || !childrenById.has(c.goal_id)) {
      return NextResponse.json(
        { error: `goal_id ${c.goal_id}: not a direct ${childLevel} child of this goal` },
        { status: 400 },
      );
    }
  }

  const childGoalIds = directChildren.map((g) => g.id);
  const existingByGoal = await getMetricsForGoals(childGoalIds);

  const isDownNumeric = parentMetric.kind === "numeric" && parentMetric.direction === "down";
  // tasks-KR is rejected above (their categories cascade at decomposition),
  // so distributed children never carry tasks_category_ids — always null.
  const tasksCats = null;
  const now = new Date().toISOString();

  // All inserts/updates happen in one transaction so a partial failure cannot
  // leave the parent KR with half-applied distribution (some children with
  // updated plan, others not).
  const touchedIds: string[] = await transaction(async (tx) => {
    const ids: string[] = [];
    for (const c of body.children) {
      const existing = (existingByGoal.get(c.goal_id) ?? []).find((m) => m.parent_metric_id === mid);
      if (existing) {
        if (isDownNumeric) {
          await tx.prepare(
            `UPDATE goal_metrics
                SET target_value = ?, start_value = ?, current_value = ?, updated_at = ?
              WHERE id = ?`,
          ).run(c.target_value, parentMetric.start_value, parentMetric.start_value, now, existing.id);
        } else {
          await tx.prepare(
            `UPDATE goal_metrics SET target_value = ?, updated_at = ? WHERE id = ?`,
          ).run(c.target_value, now, existing.id);
        }
        // Log target_change for audit trail (mirrors updateMetric behaviour).
        const prev = existing.target_value == null ? null : Number(existing.target_value);
        const next = c.target_value == null ? null : Number(c.target_value);
        if (prev !== next) {
          await tx.prepare(
            `INSERT INTO goal_metric_history (id, metric_id, event_type, value, prev_value, recorded_at, note)
             VALUES (?, ?, 'target_change', ?, ?, ?, ?)`,
          ).run(uuid(), existing.id, next, prev, now, "");
        }
        ids.push(existing.id);
      } else {
        const newId = uuid();
        const maxPos = await tx.prepare<{ p: number }>(
          "SELECT COALESCE(MAX(position), -1) + 1 as p FROM goal_metrics WHERE goal_id = ?",
        ).get(c.goal_id);
        await tx.prepare(
          `INSERT INTO goal_metrics (id, goal_id, kind, title, unit, target_value, current_value, start_value,
                                     direction, payload, weight, position,
                                     parent_metric_id, tasks_category_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          newId, c.goal_id, parentMetric.kind, parentMetric.title.trim(),
          parentMetric.unit ?? null, c.target_value,
          isDownNumeric ? parentMetric.start_value : 0,
          isDownNumeric ? parentMetric.start_value : null,
          parentMetric.direction ?? "up", null,
          parentMetric.weight ?? 1, Number(maxPos?.p ?? 0),
          mid, tasksCats,
        );
        ids.push(newId);
      }
    }
    return ids;
  });

  // Re-fetch outside the tx so callers get fresh rows with mapped types and
  // tasks_done/tasks_total filled in.
  const refreshed = await getMetricsForGoals(childGoalIds);
  const out: GoalMetric[] = [];
  for (const ms of refreshed.values()) {
    for (const m of ms) if (touchedIds.includes(m.id)) out.push(m);
  }

  return NextResponse.json({ metrics: out }, { status: 201 });
}
