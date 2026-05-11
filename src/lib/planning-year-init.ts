// Generates a full calendar year of periods (1 year + 4 quarters + 12 months + ~52 ISO weeks)
// for a given direction. Idempotent: existing periods are upserted.

import { upsertPeriod, listPeriods } from "@/lib/db";
import type { PlanningPeriod } from "@/types/planning";

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }
function fmt(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// ISO-8601: week starts Monday; week 1 contains the year's first Thursday.
function isoWeekRanges(year: number): Array<{ week: number; start: Date; end: Date }> {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = (jan4.getUTCDay() + 6) % 7; // Monday = 0
  const week1Start = new Date(jan4);
  week1Start.setUTCDate(jan4.getUTCDate() - dayOfWeek);

  const ranges: Array<{ week: number; start: Date; end: Date }> = [];
  for (let w = 1; w <= 53; w++) {
    const start = new Date(week1Start);
    start.setUTCDate(week1Start.getUTCDate() + (w - 1) * 7);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    // Stop when we cross into the next year by more than 3 days
    if (start.getUTCFullYear() > year && start.getUTCMonth() === 0 && start.getUTCDate() > 4) break;
    if (w === 53 && end.getUTCFullYear() > year) {
      // some years have only 52 weeks; keep week 53 only if the Thursday is in `year`
      const thursday = new Date(start);
      thursday.setUTCDate(start.getUTCDate() + 3);
      if (thursday.getUTCFullYear() !== year) break;
    }
    ranges.push({ week: w, start, end });
  }
  return ranges;
}

export interface InitYearOptions {
  direction_id: string | null;
  year: number;
}

export interface InitYearResult {
  created: PlanningPeriod[];
  skipped: number;
  total: number;
}

export async function initPlanningYear(opts: InitYearOptions): Promise<InitYearResult> {
  const { direction_id, year } = opts;

  // Snapshot existing periods to compute "skipped" vs "created".
  const existing = await listPeriods({ directionId: direction_id ?? null, year });
  const existingKey = new Set(existing.map((p) =>
    [p.type, p.quarter_n ?? "", p.month_n ?? "", p.week_n ?? ""].join("|")
  ));

  const out: PlanningPeriod[] = [];

  // 1) Year
  {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year, 11, 31));
    const row = await upsertPeriod({
      direction_id,
      type: "year",
      year,
      start_date: fmt(start),
      end_date: fmt(end),
    });
    out.push(row);
  }

  // 2) Quarters
  for (let q = 1; q <= 4; q++) {
    const startMonth = (q - 1) * 3;
    const start = new Date(Date.UTC(year, startMonth, 1));
    const end = new Date(Date.UTC(year, startMonth + 3, 0)); // last day of last month in quarter
    const row = await upsertPeriod({
      direction_id,
      type: "quarter",
      year,
      quarter_n: q,
      start_date: fmt(start),
      end_date: fmt(end),
    });
    out.push(row);
  }

  // 3) Months
  for (let m = 1; m <= 12; m++) {
    const start = new Date(Date.UTC(year, m - 1, 1));
    const end = new Date(Date.UTC(year, m, 0));
    const row = await upsertPeriod({
      direction_id,
      type: "month",
      year,
      month_n: m,
      start_date: fmt(start),
      end_date: fmt(end),
    });
    out.push(row);
  }

  // 4) Weeks (ISO-8601)
  const weeks = isoWeekRanges(year);
  for (const w of weeks) {
    const row = await upsertPeriod({
      direction_id,
      type: "week",
      year,
      week_n: w.week,
      start_date: fmt(w.start),
      end_date: fmt(w.end),
    });
    out.push(row);
  }

  const created = out.filter((p) =>
    !existingKey.has([p.type, p.quarter_n ?? "", p.month_n ?? "", p.week_n ?? ""].join("|"))
  );
  return { created, skipped: out.length - created.length, total: out.length };
}
