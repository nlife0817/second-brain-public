import type { GoalLevel } from "@/types";

export interface ChildSpec {
  level: GoalLevel;
  title: string;
  period_start: string; // YYYY-MM-DD
  period_end: string;   // YYYY-MM-DD
  position: number;
}

const RU_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(year: number, month1: number, day: number): string {
  return `${year}-${pad(month1)}-${pad(day)}`;
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate(); // month1 = 1..12, Date(y, m1, 0) → last day of m1
}

function parseISO(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Year of period_start, or current year as fallback. */
function yearFromPeriod(periodStart: string | null | undefined): number {
  if (periodStart) {
    const p = parseISO(periodStart);
    if (p) return p.y;
  }
  return new Date().getFullYear();
}

export function decomposeChildren(
  parentLevel: GoalLevel,
  periodStart: string | null,
): ChildSpec[] {
  if (parentLevel === "year") return decomposeYear(yearFromPeriod(periodStart));
  if (parentLevel === "quarter") return decomposeQuarter(periodStart);
  if (parentLevel === "month") return decomposeMonth(periodStart);
  return [];
}

function decomposeYear(year: number): ChildSpec[] {
  return [1, 2, 3, 4].map((q, i) => {
    const m1 = (q - 1) * 3 + 1;
    const m3 = m1 + 2;
    return {
      level: "quarter" as GoalLevel,
      title: `Q${q} ${year}`,
      period_start: iso(year, m1, 1),
      period_end: iso(year, m3, lastDayOfMonth(year, m3)),
      position: i,
    };
  });
}

function decomposeQuarter(periodStart: string | null): ChildSpec[] {
  if (!periodStart) return [];
  const p = parseISO(periodStart);
  if (!p) return [];
  // months derived from start month — three consecutive months including period_start month.
  const start = p.m;
  return [0, 1, 2].map((offset) => {
    const m = start + offset;
    const yr = p.y + Math.floor((m - 1) / 12);
    const m1 = ((m - 1) % 12) + 1;
    return {
      level: "month" as GoalLevel,
      title: RU_MONTHS[m1 - 1],
      period_start: iso(yr, m1, 1),
      period_end: iso(yr, m1, lastDayOfMonth(yr, m1)),
      position: offset,
    };
  });
}

function decomposeMonth(periodStart: string | null): ChildSpec[] {
  if (!periodStart) return [];
  const p = parseISO(periodStart);
  if (!p) return [];
  const lastDay = lastDayOfMonth(p.y, p.m);
  // Walk every day of the month; collect Mondays. For each, take Mon..Sun (may extend past month end — keep as-is, label by week-of-month).
  const weeks: ChildSpec[] = [];
  let weekIdx = 0;
  for (let d = 1; d <= lastDay; d++) {
    const date = new Date(p.y, p.m - 1, d);
    if (date.getDay() === 1) {
      // Monday found
      const sunday = new Date(date);
      sunday.setDate(sunday.getDate() + 6);
      weeks.push({
        level: "week",
        title: `Неделя ${weekIdx + 1} (${pad(d)}.${pad(p.m)} – ${pad(sunday.getDate())}.${pad(sunday.getMonth() + 1)})`,
        period_start: iso(p.y, p.m, d),
        period_end: iso(sunday.getFullYear(), sunday.getMonth() + 1, sunday.getDate()),
        position: weekIdx,
      });
      weekIdx++;
    }
  }
  // If the 1st is not a Monday, also add a partial first week (from 1st to first Sunday) for completeness.
  const firstDate = new Date(p.y, p.m - 1, 1);
  if (firstDate.getDay() !== 1) {
    const daysToSunday = (7 - firstDate.getDay()) % 7;
    const sundayDay = 1 + daysToSunday;
    weeks.unshift({
      level: "week",
      title: `Неделя 1 (${pad(1)}.${pad(p.m)} – ${pad(sundayDay)}.${pad(p.m)})`,
      period_start: iso(p.y, p.m, 1),
      period_end: iso(p.y, p.m, sundayDay),
      position: 0,
    });
    // Re-position
    weeks.forEach((w, i) => {
      w.position = i;
      w.title = w.title.replace(/^Неделя \d+/, `Неделя ${i + 1}`);
    });
  }
  return weeks;
}
