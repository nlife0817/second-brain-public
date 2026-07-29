// Модель ганта: как из задачи получается полоса, какой кусок времени показывать
// и из чего собирается шкала. Чистые функции без React — их проверяют тесты, а
// компонент занимается только отрисовкой и жестами.
//
// Всё считается в ISO-днях (`YYYY-MM-DD`), а не в объектах Date: даты приезжают
// из базы строками (PG_TYPES в lib/sql.ts), и любое приведение к Date — это
// местная полночь, то есть сдвиг на день для половины часовых поясов. Где Date
// всё же нужен для арифметики, он берётся в UTC.

import type { TaskRow } from "./types";

// --- Арифметика дней -------------------------------------------------------------

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

// --- Полоса задачи ---------------------------------------------------------------

/**
 * Полоса на полотне. `end` включительный: задача со сроком 5-го числа занимает
 * весь пятый день, а не заканчивается в его начале.
 */
export interface GanttBar {
  taskId: string;
  start: string;
  end: string;
  /** Известна одна дата — рисуется ромбом, а не отрезком. */
  milestone: boolean;
  /** Срок прошёл, а задача не завершена. */
  overdue: boolean;
  done: boolean;
  /**
   * Начало позже срока. Схема такой план не запрещает (см. миграцию 0044):
   * это состояние, которое человек должен увидеть и исправить, поэтому полоса
   * рисуется по сроку и помечается, а не молча переворачивается.
   */
  invalid: boolean;
  /**
   * Какое поле задачи держит левый край. У отрезка это всегда `start_date`, у
   * вехи — то единственное поле, которое заполнено.
   */
  anchor: "start_date" | "due_date";
}

/**
 * Полоса задачи или `null`, если дат нет вовсе — такие задачи живут в отдельной
 * секции списка и на полотне не появляются, пока им не назначат срок.
 *
 * Задача с одной датой — веха: рисовать ей полосу «от начала до сегодня» значит
 * придумать длительность, которой никто не задавал.
 */
export function barOf(task: TaskRow, today: string): GanttBar | null {
  const { start_date: start, due_date: due } = task;
  if (!start && !due) return null;

  const done = !!task.completed_at;
  const overdue = !done && !!due && due < today;

  if (start && due) {
    const invalid = due < start;
    return {
      taskId: task.id,
      start: invalid ? due : start,
      end: due,
      milestone: false,
      overdue,
      done,
      invalid,
      anchor: "start_date",
    };
  }

  return {
    taskId: task.id,
    start: (due ?? start)!,
    end: (due ?? start)!,
    milestone: true,
    overdue,
    done,
    invalid: false,
    anchor: due ? "due_date" : "start_date",
  };
}

/** Общий охват набора полос. */
export function spanOf(bars: readonly GanttBar[]): { from: string; to: string } | null {
  let from: string | null = null;
  let to: string | null = null;
  for (const b of bars) {
    if (from === null || b.start < from) from = b.start;
    if (to === null || b.end > to) to = b.end;
  }
  return from && to ? { from, to } : null;
}

// --- Масштаб и окно --------------------------------------------------------------

export type GanttScale = "day" | "week" | "month";

export const SCALE_LABELS: Record<GanttScale, string> = {
  day: "Дни",
  week: "Недели",
  month: "Месяцы",
};

/** Ширина одного дня в пикселях. Задаёт и плотность, и читаемость подписей. */
export const DAY_WIDTH: Record<GanttScale, number> = { day: 34, week: 13, month: 4 };

/** Отступ от крайних полос, чтобы они не упирались в край полотна. */
const PADDING_DAYS: Record<GanttScale, number> = { day: 3, week: 7, month: 31 };

/** Минимальное окно: на пустом полотне всё равно должно быть что показать. */
const MIN_SPAN_DAYS: Record<GanttScale, number> = { day: 30, week: 120, month: 400 };

/**
 * Окно времени: охват полос плюс отступы, но не уже минимума и всегда включая
 * сегодня — линия текущего дня за краем полотна бесполезна.
 *
 * Края округляются до начала недели и конца месяца, иначе шкала начинается с
 * середины подписи («ср 17» без «июля»).
 */
export function ganttRange(
  bars: readonly GanttBar[],
  today: string,
  scale: GanttScale,
): { from: string; to: string } {
  const span = spanOf(bars);
  const pad = PADDING_DAYS[scale];
  let from = span ? addDays(span.from, -pad) : addDays(today, -pad);
  let to = span ? addDays(span.to, pad) : addDays(today, pad);

  if (today < from) from = addDays(today, -pad);
  if (today > to) to = addDays(today, pad);

  const min = MIN_SPAN_DAYS[scale];
  if (diffDays(from, to) < min) to = addDays(from, min);

  // Ровные края: неделя начинается с понедельника, месяц — с первого числа.
  from = scale === "month" ? startOfMonth(from) : startOfWeek(from);
  const tail = startOfMonth(to);
  to = scale === "month" ? addDays(tail, daysInMonth(tail) - 1) : addDays(startOfWeek(to), 6);
  return { from, to };
}

// --- Шкала -----------------------------------------------------------------------

/** Деление шкалы: подпись и её протяжённость в днях от `start`. */
export interface Tick {
  key: string;
  label: string;
  start: string;
  days: number;
}

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_FULL = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

function monthIndex(iso: string): number {
  return Number(iso.slice(5, 7)) - 1;
}

/** Все дни окна — нужны и для сетки, и для затенения выходных. */
export function daysOf(range: { from: string; to: string }): string[] {
  const total = diffDays(range.from, range.to) + 1;
  return Array.from({ length: total }, (_, i) => addDays(range.from, i));
}

/**
 * Две строки шапки: крупная (месяц или год) и мелкая (день, неделя или месяц).
 * Обрезаются по краям окна — иначе первый месяц вылезал бы левее полотна и
 * подпись уезжала бы за границу прокрутки.
 */
export function buildTicks(
  range: { from: string; to: string },
  scale: GanttScale,
): { major: Tick[]; minor: Tick[] } {
  const total = diffDays(range.from, range.to) + 1;

  const byMonth = (): Tick[] => {
    const out: Tick[] = [];
    let cursor = range.from;
    while (cursor <= range.to) {
      const monthStart = startOfMonth(cursor);
      const monthEnd = addDays(monthStart, daysInMonth(monthStart) - 1);
      const end = monthEnd > range.to ? range.to : monthEnd;
      out.push({
        key: monthStart.slice(0, 7),
        label: `${MONTHS_FULL[monthIndex(monthStart)]} ${monthStart.slice(0, 4)}`,
        start: cursor,
        days: diffDays(cursor, end) + 1,
      });
      cursor = addDays(end, 1);
    }
    return out;
  };

  if (scale === "day") {
    return {
      major: byMonth(),
      minor: daysOf(range).map((iso) => ({
        key: iso,
        label: `${WEEKDAYS_SHORT[weekday(iso)]} ${Number(iso.slice(8, 10))}`,
        start: iso,
        days: 1,
      })),
    };
  }

  if (scale === "week") {
    const minor: Tick[] = [];
    let cursor = range.from;
    while (cursor <= range.to) {
      const weekEnd = addDays(cursor, 6);
      const end = weekEnd > range.to ? range.to : weekEnd;
      minor.push({
        key: cursor,
        label: `${Number(cursor.slice(8, 10))} ${MONTHS_SHORT[monthIndex(cursor)]}`,
        start: cursor,
        days: diffDays(cursor, end) + 1,
      });
      cursor = addDays(end, 1);
    }
    return { major: byMonth(), minor };
  }

  // Месяцы: сверху годы, снизу месяцы.
  const minor = byMonth().map((t) => ({ ...t, label: MONTHS_SHORT[monthIndex(t.start)] }));
  const major: Tick[] = [];
  let cursor = range.from;
  while (cursor <= range.to) {
    const year = cursor.slice(0, 4);
    const yearEnd = `${year}-12-31`;
    const end = yearEnd > range.to ? range.to : yearEnd;
    major.push({ key: year, label: year, start: cursor, days: diffDays(cursor, end) + 1 });
    cursor = addDays(end, 1);
  }
  return { major, minor: minor.length ? minor : [{ key: range.from, label: "", start: range.from, days: total }] };
}

// --- Геометрия -------------------------------------------------------------------

/** Отступ полосы от левого края полотна в пикселях. */
export function xOf(iso: string, range: { from: string }, scale: GanttScale): number {
  return diffDays(range.from, iso) * DAY_WIDTH[scale];
}

/** Ширина полосы. Конец включительный, поэтому день добавляется. */
export function widthOf(bar: { start: string; end: string }, scale: GanttScale): number {
  return (diffDays(bar.start, bar.end) + 1) * DAY_WIDTH[scale];
}

/**
 * День под курсором. Полотно прокручивается, поэтому x приходит уже от левого
 * края содержимого, а не окна.
 */
export function dayAt(x: number, range: { from: string }, scale: GanttScale): string {
  return addDays(range.from, Math.floor(x / DAY_WIDTH[scale]));
}

// --- Перетаскивание --------------------------------------------------------------

export type DragKind = "move" | "resize-start" | "resize-end";

/**
 * Новые даты полосы после жеста, сдвинутого на `days` дней. Возвращает то, что
 * уйдёт в PATCH: у вехи двигается только её единственная дата.
 *
 * Растягивание не даёт схлопнуть полосу «наизнанку» — край упирается в
 * противоположный. Без этого рывок мышью на 300 пикселей влево превращал
 * недельную задачу в задачу, которая кончается раньше, чем началась.
 */
export function dragBar(
  bar: GanttBar,
  kind: DragKind,
  days: number,
): { start_date?: string | null; due_date?: string | null } {
  if (days === 0) return {};

  if (bar.milestone) {
    // У вехи известна ровно одна дата — её и двигаем, чем бы ни тянули.
    return { [milestoneField(bar)]: addDays(bar.start, days) };
  }

  if (kind === "move") {
    return { start_date: addDays(bar.start, days), due_date: addDays(bar.end, days) };
  }
  if (kind === "resize-start") {
    const next = addDays(bar.start, days);
    return { start_date: next > bar.end ? bar.end : next };
  }
  const next = addDays(bar.end, days);
  return { due_date: next < bar.start ? bar.start : next };
}

/**
 * Какое поле держит дату вехи: у неё заполнено ровно одно, и двигать нужно
 * именно его — иначе жест завёл бы задаче вторую дату вместо перемещения
 * первой.
 */
function milestoneField(bar: GanttBar): "start_date" | "due_date" {
  return bar.anchor;
}
