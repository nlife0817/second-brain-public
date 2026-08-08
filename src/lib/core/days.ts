// Арифметика дней и русские названия месяцев — общее у ганта и календаря.
//
// Всё считается в ISO-днях (`YYYY-MM-DD`), а не в объектах Date: даты приезжают
// из базы строками (PG_TYPES в lib/sql.ts), и любое приведение к Date — это
// местная полночь, то есть сдвиг на день для половины часовых поясов. Где Date
// всё же нужен для арифметики, он берётся в UTC.
//
// Модуль появился, когда к ганту добавился календарь: две копии этих функций
// разошлись бы на первой же правке, а «неделя начинается с понедельника» должно
// быть одним фактом, а не двумя одинаковыми.

const DAY_MS = 86_400_000;

function parseDay(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function toIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  return toIso(parseDay(iso) + days * DAY_MS);
}

/** Сколько дней от `from` до `to`. Отрицательное — `to` раньше. */
export function diffDays(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / DAY_MS);
}

/** 0 — понедельник, 6 — воскресенье. */
export function weekday(iso: string): number {
  return (new Date(parseDay(iso)).getUTCDay() + 6) % 7;
}

export function isWeekend(iso: string): boolean {
  return weekday(iso) >= 5;
}

/** Понедельник недели, в которую попадает день. */
export function startOfWeek(iso: string): string {
  return addDays(iso, -weekday(iso));
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function daysInMonth(iso: string): number {
  const d = new Date(parseDay(iso));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export function endOfMonth(iso: string): string {
  const first = startOfMonth(iso);
  return addDays(first, daysInMonth(first) - 1);
}

/** Все дни окна включительно — нужны и для сетки, и для затенения выходных. */
export function daysOf(range: { from: string; to: string }): string[] {
  const total = diffDays(range.from, range.to) + 1;
  if (total <= 0) return [];
  return Array.from({ length: total }, (_, i) => addDays(range.from, i));
}

export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export const MONTHS_FULL = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

/** Родительный падеж: «30 июля», а не «30 июль». */
export const MONTHS_OF = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export const WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

export const WEEKDAYS_FULL = [
  "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье",
];

export function monthIndex(iso: string): number {
  return Number(iso.slice(5, 7)) - 1;
}

/** Число дня без ведущего нуля. */
export function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}
