// ISO-week utilities (Monday-start). Все даты — UTC, чтобы не плыли через таймзоны.
// Источник истины — алгоритм ISO 8601: неделя 1 — та, что содержит четверг (или 4 января).

export interface IsoWeekInfo {
  year: number;
  week: number;
  start: Date; // Monday UTC 00:00
  end: Date;   // Sunday UTC 00:00
}

export function isoWeek(d: Date): IsoWeekInfo {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  // Thursday of this week defines the ISO year
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week = Math.round(((thursday.getTime() - firstThursday.getTime()) / 86_400_000 + 1) / 7) + 1;
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - dayNum);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { year: thursday.getUTCFullYear(), week, start, end };
}

export function weekKey(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function parseWeekKey(key: string): { year: number; week: number } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) return null;
  return { year, week };
}

/** Понедельник ISO-недели `week` в году `year` (UTC). */
export function weekStartDate(year: number, week: number): Date {
  // Алгоритм: 4 января — гарантированно в неделе 1. Считаем смещение от него.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7; // Mon=0
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day);
  const start = new Date(week1Monday);
  start.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return start;
}

export function weekFromKey(key: string): IsoWeekInfo | null {
  const parsed = parseWeekKey(key);
  if (!parsed) return null;
  const start = weekStartDate(parsed.year, parsed.week);
  return isoWeek(start);
}

/** Сколько ISO-недель в году (52 или 53). */
export function weeksInYear(year: number): 52 | 53 {
  // Год имеет 53 недели если 1 января — четверг, или 31 декабря — четверг (high-year).
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const dec31 = new Date(Date.UTC(year, 11, 31)).getUTCDay();
  return jan1 === 4 || dec31 === 4 ? 53 : 52;
}

/** Квартал, в котором лежит четверг ISO-недели (надёжный определитель). */
export function quarterOfWeek(year: number, week: number): 1 | 2 | 3 | 4 {
  const monday = weekStartDate(year, week);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const m = thursday.getUTCMonth(); // 0..11
  return (Math.floor(m / 3) + 1) as 1 | 2 | 3 | 4;
}

/** Месяц (1..12), в который попадает четверг ISO-недели. */
export function monthOfWeek(year: number, week: number): number {
  const monday = weekStartDate(year, week);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  return thursday.getUTCMonth() + 1;
}

export interface WeekInRange {
  year: number;
  week: number;
  start: Date;
  end: Date;
  /** Месяц четверга (1..12) — основной «дом» недели. */
  ownerMonth: number;
  /** Если start/end лежат в разных месяцах — true. */
  crossMonth: boolean;
}

/** Все недели, у которых хотя бы один день попадает в месяц `month` года `year`. */
export function weeksInMonth(year: number, month: number): WeekInRange[] {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(year, month, 0));
  const result: WeekInRange[] = [];
  const seen = new Set<string>();

  // Берём ISO-неделю первого и последнего дня и всё, что между.
  const firstWeek = isoWeek(firstDay);
  const lastWeek = isoWeek(lastDay);

  const pushIfNew = (w: IsoWeekInfo) => {
    const k = weekKey(w.year, w.week);
    if (seen.has(k)) return;
    seen.add(k);
    const own = monthOfWeek(w.year, w.week);
    const crossMonth = w.start.getUTCMonth() !== w.end.getUTCMonth();
    result.push({ year: w.year, week: w.week, start: w.start, end: w.end, ownerMonth: own, crossMonth });
  };

  pushIfNew(firstWeek);
  // Идём по понедельникам шагом 7 дней.
  let cursor = new Date(firstWeek.start);
  cursor.setUTCDate(cursor.getUTCDate() + 7);
  while (cursor.getTime() <= lastWeek.start.getTime()) {
    pushIfNew(isoWeek(cursor));
    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  pushIfNew(lastWeek);

  return result.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Месяцы квартала `q` (1..4) в году `year`. */
export function monthsOfQuarter(q: 1 | 2 | 3 | 4): number[] {
  const start = (q - 1) * 3 + 1;
  return [start, start + 1, start + 2];
}

export function formatDayShort(date: Date): string {
  const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  return `${date.getUTCDate()} ${MONTH_SHORT[date.getUTCMonth()]}`;
}
