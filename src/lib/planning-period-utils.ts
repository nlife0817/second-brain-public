// Helpers for working with PlanningPeriod ranges: finding the period that
// contains a date, and intersecting initiative spans (start..end) with a
// filter period for the InitiativeColumn cascade filter (P2).

import type { PlanningPeriod, PeriodType } from "@/types/planning";

function ts(s: string): number { return new Date(s).getTime(); }

// Returns the period of given type that contains `now`, or null.
// If multiple match (shouldn't happen for canonical seed), takes the first.
export function findCurrentPeriod(
  periods: PlanningPeriod[],
  type: PeriodType,
  now: Date = new Date(),
): PlanningPeriod | null {
  const t = now.getTime();
  for (const p of periods) {
    if (p.type !== type) continue;
    // end_date stored as a date (YYYY-MM-DD) — treat as exclusive of the next day.
    const start = ts(p.start_date);
    const end = ts(p.end_date) + 86_399_000; // include the whole end day
    if (t >= start && t <= end) return p;
  }
  return null;
}

// Initiative spans a date range from start_period.start_date to end_period.end_date.
// `filter` defines a single period to intersect with.
// Returns true if [iniStart, iniEnd] ∩ [filterStart, filterEnd] is non-empty.
//
// When initiative has neither start nor end, returns true (no constraint).
// When only one of start/end is set, the other defaults to it (treated as a
// single-week span).
export function initiativeIntersectsPeriod(
  startPeriod: PlanningPeriod | null,
  endPeriod: PlanningPeriod | null,
  filter: PlanningPeriod,
): boolean {
  const eff = startPeriod ?? endPeriod;
  const effEnd = endPeriod ?? startPeriod;
  if (!eff || !effEnd) return false; // unscheduled — hide when a filter is active
  const iniStart = ts(eff.start_date);
  const iniEnd = ts(effEnd.end_date);
  const fStart = ts(filter.start_date);
  const fEnd = ts(filter.end_date);
  return Math.max(iniStart, fStart) <= Math.min(iniEnd, fEnd);
}

// Group periods by quarter (Q1..Q4) for the cascade filter and WeekGridPicker.
// Returns { quarters: PlanningPeriod[], monthsByQuarter, weeksByMonth, weeksByQuarter }.
export interface YearShape {
  year: number;
  quarters: PlanningPeriod[]; // length 4 (q1..q4) for the year
  months: PlanningPeriod[];   // up to 12
  weeks: PlanningPeriod[];    // up to 53
  monthsByQuarter: Map<number, PlanningPeriod[]>;
  weeksByMonth: Map<number, PlanningPeriod[]>;
  weeksByQuarter: Map<number, PlanningPeriod[]>;
}

export function buildYearShape(periods: PlanningPeriod[], year: number): YearShape {
  const inYear = periods.filter((p) => p.year === year);
  const quarters = inYear
    .filter((p) => p.type === "quarter")
    .sort((a, b) => (a.quarter_n ?? 0) - (b.quarter_n ?? 0));
  const months = inYear
    .filter((p) => p.type === "month")
    .sort((a, b) => (a.month_n ?? 0) - (b.month_n ?? 0));
  const weeks = inYear
    .filter((p) => p.type === "week")
    .sort((a, b) => (a.week_n ?? 0) - (b.week_n ?? 0));

  const monthsByQuarter = new Map<number, PlanningPeriod[]>();
  for (const m of months) {
    if (m.month_n == null) continue;
    const q = Math.ceil(m.month_n / 3);
    if (!monthsByQuarter.has(q)) monthsByQuarter.set(q, []);
    monthsByQuarter.get(q)!.push(m);
  }

  const weeksByMonth = new Map<number, PlanningPeriod[]>();
  const weeksByQuarter = new Map<number, PlanningPeriod[]>();
  for (const w of weeks) {
    const wStart = new Date(w.start_date);
    const wEnd = new Date(w.end_date);
    // Heuristic: assign week to the month containing its midpoint.
    const mid = new Date((wStart.getTime() + wEnd.getTime()) / 2);
    const monthN = mid.getUTCMonth() + 1; // 1..12
    if (!weeksByMonth.has(monthN)) weeksByMonth.set(monthN, []);
    weeksByMonth.get(monthN)!.push(w);
    const q = Math.ceil(monthN / 3);
    if (!weeksByQuarter.has(q)) weeksByQuarter.set(q, []);
    weeksByQuarter.get(q)!.push(w);
  }

  return { year, quarters, months, weeks, monthsByQuarter, weeksByMonth, weeksByQuarter };
}

// Find quarter_n / month_n that the given period belongs to (1-based).
// Used by the cascade filter to auto-expand parents when a week is the
// active filter.
export function periodParents(
  period: PlanningPeriod,
  shape: YearShape,
): { quarter: PlanningPeriod | null; month: PlanningPeriod | null } {
  if (period.type === "quarter") return { quarter: period, month: null };
  if (period.type === "month") {
    const q = period.month_n != null ? Math.ceil(period.month_n / 3) : null;
    return {
      quarter: q != null ? (shape.quarters.find((p) => p.quarter_n === q) ?? null) : null,
      month: period,
    };
  }
  if (period.type === "week") {
    const mid = new Date(
      (new Date(period.start_date).getTime() + new Date(period.end_date).getTime()) / 2,
    );
    const monthN = mid.getUTCMonth() + 1;
    const q = Math.ceil(monthN / 3);
    return {
      quarter: shape.quarters.find((p) => p.quarter_n === q) ?? null,
      month: shape.months.find((p) => p.month_n === monthN) ?? null,
    };
  }
  return { quarter: null, month: null };
}
