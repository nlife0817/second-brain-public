// Formatting helpers for planning UI labels.

import type { PlanningPeriod } from "@/types/planning";

const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const CURRENT_YEAR = () => new Date().getUTCFullYear();

// Short period label for card chips: "W23", "Q2", "май", "2026".
export function formatPeriodShort(period: PlanningPeriod): string {
  switch (period.type) {
    case "week":    return period.week_n != null ? `W${period.week_n}` : "—";
    case "month":   return period.month_n != null ? MONTH_SHORT[period.month_n - 1] ?? "—" : "—";
    case "quarter": return period.quarter_n != null ? `Q${period.quarter_n}` : "—";
    case "year":    return String(period.year);
  }
}

/**
 * Human label for tables / chips. Strips redundant context:
 * - hides year if it matches the current calendar year
 * - shows days ONLY for weeks (quarters/months don't need day-level detail)
 *
 * Examples (current year):
 *   year     → "Год"
 *   quarter  → "Q1 · янв–мар"
 *   month    → "май"
 *   week     → "W19 · 4–10 май"
 *
 * Examples (non-current year):
 *   year     → "2027"
 *   quarter  → "Q1 2027 · янв–мар"
 *   month    → "май 2027"
 *   week     → "W19 2027 · 4–10 май"
 */
export function formatPeriodFull(period: PlanningPeriod): string {
  const startD = new Date(period.start_date);
  const endD = new Date(period.end_date);
  const mStart = MONTH_SHORT[startD.getUTCMonth()] ?? "";
  const mEnd = MONTH_SHORT[endD.getUTCMonth()] ?? "";
  const dStart = startD.getUTCDate();
  const dEnd = endD.getUTCDate();
  const isCurrentYear = period.year === CURRENT_YEAR();
  const yearSuffix = isCurrentYear ? "" : ` ${period.year}`;

  switch (period.type) {
    case "year":
      return isCurrentYear ? "Год" : String(period.year);
    case "quarter":
      return `Q${period.quarter_n}${yearSuffix} · ${mStart}–${mEnd}`;
    case "month":
      return isCurrentYear ? mStart : `${mStart} ${period.year}`;
    case "week": {
      const range = mStart === mEnd
        ? `${dStart}–${dEnd} ${mStart}`
        : `${dStart} ${mStart} – ${dEnd} ${mEnd}`;
      return `W${period.week_n}${yearSuffix} · ${range}`;
    }
  }
}

// End-date label, e.g. "до 31 мая".
export function formatPeriodEnd(period: PlanningPeriod): string {
  try {
    const d = new Date(period.end_date);
    const day = d.getUTCDate();
    const m = MONTH_SHORT[d.getUTCMonth()] ?? "";
    return `до ${day} ${m}`;
  } catch {
    return "—";
  }
}

// Compact value formatter for metric cards.
// 12345 → "12,3K"; 1234567 → "1,23M"; 0.123 → "0,12".
export function formatMetricValue(v: number | null | undefined, unit?: string | null): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  let body: string;
  if (abs >= 1_000_000) body = `${(v / 1_000_000).toFixed(2).replace(".", ",")}M`;
  else if (abs >= 10_000) body = `${(v / 1_000).toFixed(1).replace(".", ",")}K`;
  else if (abs >= 1_000) body = v.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
  else if (Number.isInteger(v)) body = String(v);
  else body = v.toFixed(2).replace(".", ",");
  return unit ? `${body} ${unit}` : body;
}
