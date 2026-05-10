// Recurring task series — rule definitions, instance-date generation and
// human-readable description. Used by both the API (when materialising
// instances into `items`) and the UI (RecurrenceEditor + ListView badge).

export type RecurrenceFreq = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval: number;          // every N (units depend on freq)
  byweekday?: number[] | null; // 0=Sun .. 6=Sat — only for "weekly"
  bymonthday?: number | null;  // 1..31 — only for "monthly"; null → use day from start_date
  start_date: string;        // YYYY-MM-DD
  until_date: string;        // YYYY-MM-DD inclusive
}

export const MAX_INSTANCES = 500;

const WEEKDAY_LABELS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  // Clamp day for shorter months (e.g. Jan 31 + 1 month → Feb 28/29).
  const lastDay = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, lastDay));
  return r;
}

function addYears(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCFullYear(r.getUTCFullYear() + n);
  return r;
}

/** Returns YYYY-MM-DD list of dates matching the rule, between [from, until_date]. */
export function generateInstanceDates(rule: RecurrenceRule, from?: string): string[] {
  const start = parseDate(rule.start_date);
  const until = parseDate(rule.until_date);
  const fromDate = from ? parseDate(from) : start;
  const out: string[] = [];
  const interval = Math.max(1, Math.floor(rule.interval ?? 1));

  if (rule.freq === "daily") {
    let cur = new Date(start.getTime());
    while (cur.getTime() <= until.getTime()) {
      if (cur.getTime() >= fromDate.getTime()) out.push(formatDate(cur));
      cur = addDays(cur, interval);
      if (out.length >= MAX_INSTANCES) break;
    }
  } else if (rule.freq === "weekdays") {
    let cur = new Date(start.getTime());
    while (cur.getTime() <= until.getTime()) {
      const wd = cur.getUTCDay();
      if (wd >= 1 && wd <= 5 && cur.getTime() >= fromDate.getTime()) out.push(formatDate(cur));
      cur = addDays(cur, 1);
      if (out.length >= MAX_INSTANCES) break;
    }
  } else if (rule.freq === "weekly") {
    const days = (rule.byweekday && rule.byweekday.length > 0)
      ? [...rule.byweekday].sort((a, b) => a - b)
      : [start.getUTCDay()];
    // Walk by week-blocks of `interval` weeks; emit selected weekdays inside each block.
    const startWeekStart = addDays(start, -start.getUTCDay()); // Sunday of start week
    let weekStart = startWeekStart;
    while (weekStart.getTime() <= until.getTime()) {
      for (const wd of days) {
        const day = addDays(weekStart, wd);
        if (day.getTime() < start.getTime()) continue;
        if (day.getTime() > until.getTime()) continue;
        if (day.getTime() >= fromDate.getTime()) out.push(formatDate(day));
        if (out.length >= MAX_INSTANCES) break;
      }
      if (out.length >= MAX_INSTANCES) break;
      weekStart = addDays(weekStart, 7 * interval);
    }
  } else if (rule.freq === "monthly") {
    const targetDay = rule.bymonthday && rule.bymonthday >= 1 && rule.bymonthday <= 31
      ? rule.bymonthday
      : start.getUTCDate();
    let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cur.getTime() <= until.getTime()) {
      const lastDay = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0)).getUTCDate();
      const day = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), Math.min(targetDay, lastDay)));
      if (day.getTime() >= start.getTime() && day.getTime() <= until.getTime()
          && day.getTime() >= fromDate.getTime()) {
        out.push(formatDate(day));
      }
      cur = addMonths(cur, interval);
      if (out.length >= MAX_INSTANCES) break;
    }
  } else if (rule.freq === "yearly") {
    let cur = new Date(start.getTime());
    while (cur.getTime() <= until.getTime()) {
      if (cur.getTime() >= fromDate.getTime()) out.push(formatDate(cur));
      cur = addYears(cur, interval);
      if (out.length >= MAX_INSTANCES) break;
    }
  }

  return out;
}

/** Validates rule. Throws on invalid input. Returns nothing. */
export function validateRecurrenceRule(rule: RecurrenceRule): void {
  if (!rule.start_date || !rule.until_date) throw new Error("start_date и until_date обязательны");
  if (parseDate(rule.until_date).getTime() < parseDate(rule.start_date).getTime()) {
    throw new Error("until_date должна быть не раньше start_date");
  }
  if (!Number.isFinite(rule.interval) || rule.interval < 1) throw new Error("interval должен быть ≥ 1");
  if (rule.freq === "weekly" && rule.byweekday && rule.byweekday.length > 0) {
    if (!rule.byweekday.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      throw new Error("byweekday: значения должны быть 0..6");
    }
  }
  if (rule.freq === "monthly" && rule.bymonthday != null) {
    if (!Number.isInteger(rule.bymonthday) || rule.bymonthday < 1 || rule.bymonthday > 31) {
      throw new Error("bymonthday: 1..31");
    }
  }
}

/** Human-readable rule for badges/tooltips. */
export function describeRule(rule: RecurrenceRule): string {
  const interval = rule.interval ?? 1;
  let head = "";
  switch (rule.freq) {
    case "daily":
      head = interval === 1 ? "Ежедневно" : `Каждые ${interval} дн.`;
      break;
    case "weekdays":
      head = "По будням";
      break;
    case "weekly": {
      const days = rule.byweekday && rule.byweekday.length > 0
        ? rule.byweekday.slice().sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d]).join(", ")
        : null;
      const base = interval === 1 ? "Еженедельно" : `Каждые ${interval} нед.`;
      head = days ? `${base}: ${days}` : base;
      break;
    }
    case "monthly": {
      const day = rule.bymonthday ?? Number(rule.start_date.slice(8, 10));
      head = interval === 1 ? `Ежемесячно ${day} числа` : `Каждые ${interval} мес. ${day} числа`;
      break;
    }
    case "yearly":
      head = interval === 1 ? "Ежегодно" : `Каждые ${interval} г.`;
      break;
  }
  return `${head} · до ${formatHumanDate(rule.until_date)}`;
}

function formatHumanDate(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}
