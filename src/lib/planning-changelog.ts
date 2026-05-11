// Helpers for writing entries into planning_change_log and suggesting replan reasons.
// See planning_system_concept.md §6.7.6 and §10.

import { appendChangeLog, getPlanningSettings } from "./db";
import type {
  ChangeLogInsertInput,
  ReplanReason,
  ReplanReasonCode,
} from "@/types/planning";

type DiffMap = Record<string, { from: unknown; to: unknown }>;

/**
 * Build a flat diff of two records, keeping only fields whose value differs
 * (using JSON.stringify equality for nested values).
 */
export function buildDiff<T extends Record<string, unknown>>(before: T | undefined | null, after: T): DiffMap {
  const diff: DiffMap = {};
  const a = (before ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(after)) {
    const from = a[key];
    const to = (after as Record<string, unknown>)[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      diff[key] = { from, to };
    }
  }
  return diff;
}

/** Append a change-log entry — wrapper around the db helper. */
export async function logChange(input: ChangeLogInsertInput): Promise<void> {
  await appendChangeLog(input);
}

/**
 * Suggest a replan_reason category based on what changed.
 * Pure heuristic — no DB calls — so the caller can show it as a default in
 * the diaology and let the user override.
 */
export function suggestReplanReason(diff: DiffMap): ReplanReasonCode | null {
  if ("kill_criteria_triggered" in diff) return "kill_criteria_triggered";
  if (diff.due_period_id) return "scope_underestimated";
  if (diff.estimate_hours) {
    const from = Number(diff.estimate_hours.from ?? 0);
    const to = Number(diff.estimate_hours.to ?? 0);
    if (to > from) return "scope_underestimated";
    if (to < from && from > 0) return "scope_overestimated";
  }
  if (diff.status && diff.status.to === "killed") return "kill_criteria_triggered";
  if (diff.target_value) return "priority_changed";
  if (diff.is_emergent && diff.is_emergent.to === true) return "external_event";
  return null;
}

/**
 * Check whether a metric-target change is "minor" — within the
 * planning_settings.minor_adjustment_threshold band.
 *
 * Returns `{ minor: true, reason: { code: 'minor_adjustment' } }` if the user
 * can skip the replan dialog; `{ minor: false }` otherwise.
 */
export async function classifyTargetChange(oldValue: number | null | undefined, newValue: number): Promise<{
  minor: boolean;
  reason?: ReplanReason;
}> {
  if (oldValue == null || oldValue === 0) return { minor: false };
  const settings = await getPlanningSettings();
  const threshold = Number(settings.minor_adjustment_threshold ?? 0.05);
  const delta = Math.abs((newValue - oldValue) / oldValue);
  if (delta <= threshold) {
    return { minor: true, reason: { code: "minor_adjustment" } };
  }
  return { minor: false };
}
