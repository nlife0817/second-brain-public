// Модель календаря: во что превращается задача или внешнее событие, какое окно
// показывает масштаб, как раскладываются пересечения и что уходит в патч после
// перетаскивания. Чистые функции без React — их проверяют тесты, а компонент
// занимается отрисовкой и жестами.
//
// Арифметика дней — из `days.ts`, общая с гантом.
//
// Ключевое различие двух источников, из-за которого модель выглядит именно так:
//
//  * Срок и начало задачи — «плавающие» дата и время без зоны (миграция 0024,
//    как в Asana). Задача «30 июля, 10:00» остаётся десятым часом в любой точке
//    мира: это обещание, а не момент.
//  * Внешнее событие — момент (timestamptz). Встреча, назначенная коллегой в
//    Берлине, наступает в один и тот же миг, и в Москве это другой час.
//
// Поэтому событие приводится к местным дню и минутам ровно один раз, на входе
// (`localPoint`), и дальше вся раскладка работает с одинаковыми парами
// «день + минуты от полуночи». Так в модели нет ни одного места, где часовой
// пояс мог бы примешаться повторно.

import {
  MONTHS_FULL,
  MONTHS_OF,
  WEEKDAYS_FULL,
  addDays,
  dayOfMonth,
  daysInMonth,
  daysOf,
  diffDays,
  endOfMonth,
  monthIndex,
  startOfMonth,
  startOfWeek,
} from "./days";
import type { CalendarEventRow, TaskRow } from "./types";

export const MINUTES_IN_DAY = 1440;

/**
 * Длительность, которую календарь показывает у задачи с одним временем. Она
 * НЕ записывается в задачу: пометка `inferredStart`/`inferredEnd` доносит до
 * полотна, что край нарисован, а не задан, — он рисуется пунктиром, а
 * перетаскивание этого края как раз и превращает его в настоящий.
 */
export const DEFAULT_SLOT_MINUTES = 60;

/** Сетка, к которой прижимаются жесты. Четверть часа — как в Google Calendar. */
export const SNAP_MINUTES = 15;

/**
 * Минимум, которым событие участвует в раскладке пересечений. Встреча на пять
 * минут занимает на экране больше своей длительности, и без этого запаса
 * соседний блок наезжал бы на неё, считая место свободным.
 */
export const MIN_BLOCK_MINUTES = 20;

// --- Масштаб и окно ----------------------------------------------------------------

export type CalendarScale = "month" | "week" | "day";

export const CALENDAR_SCALE_LABELS: Record<CalendarScale, string> = {
  month: "Месяц",
  week: "Неделя",
  day: "День",
};

export interface DayRange {
  from: string;
  to: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Окно масштаба вокруг опорного дня.
 *
 * Месяц раскладывается ЦЕЛЫМИ неделями: сетка обязана начинаться с
 * понедельника, иначе столбец «пн» окажется не под понедельником. Число строк
 * при этом плавает (4–6) — фиксированные шесть недель, как в поповере выбора
 * даты, здесь ни к чему: там они держат высоту всплывающего окна, а полотно
 * растягивается на экран целиком.
 */
export function calendarRange(anchor: string, scale: CalendarScale): DayRange {
  if (scale === "day") return { from: anchor, to: anchor };
  if (scale === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  return {
    from: startOfWeek(startOfMonth(anchor)),
    to: addDays(startOfWeek(endOfMonth(anchor)), 6),
  };
}

/** Строки сетки: окно, разрезанное по неделям. */
export function weeksOf(range: DayRange): string[][] {
  const days = daysOf(range);
  const out: string[][] = [];
  for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
  return out;
}

/**
 * Соседний период. У месяца день недели не сохраняется — сохраняется число, и
 * 31-е при переходе в февраль прижимается к последнему дню месяца, а не
 * проваливается в март (перелистнув назад, человек ожидает февраль, а не его же
 * месяц второй раз).
 */
export function shiftAnchor(anchor: string, scale: CalendarScale, delta: number): string {
  if (scale === "day") return addDays(anchor, delta);
  if (scale === "week") return addDays(anchor, delta * 7);

  const target = new Date(Date.UTC(Number(anchor.slice(0, 4)), monthIndex(anchor) + delta, 1));
  const first = `${target.getUTCFullYear()}-${pad2(target.getUTCMonth() + 1)}-01`;
  return `${first.slice(0, 8)}${pad2(Math.min(dayOfMonth(anchor), daysInMonth(first)))}`;
}

/** Подпись периода в шапке. */
export function rangeTitle(anchor: string, scale: CalendarScale): string {
  const year = anchor.slice(0, 4);
  if (scale === "month") return `${MONTHS_FULL[monthIndex(anchor)]} ${year}`;
  if (scale === "day") {
    return `${WEEKDAYS_FULL[(new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7]}, ${dayOfMonth(anchor)} ${MONTHS_OF[monthIndex(anchor)]} ${year}`;
  }
  // Неделя: повторяем у левого края только то, что справа отличается.
  // «20 — 26 июля 2026», «27 июля — 2 августа 2026»,
  // «28 декабря 2026 — 3 января 2027».
  const { from, to } = calendarRange(anchor, "week");
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const sameMonth = sameYear && monthIndex(from) === monthIndex(to);
  const left = sameMonth
    ? `${dayOfMonth(from)}`
    : sameYear
      ? `${dayOfMonth(from)} ${MONTHS_OF[monthIndex(from)]}`
      : `${dayOfMonth(from)} ${MONTHS_OF[monthIndex(from)]} ${from.slice(0, 4)}`;
  return `${left} — ${dayOfMonth(to)} ${MONTHS_OF[monthIndex(to)]} ${to.slice(0, 4)}`;
}

// --- Время -------------------------------------------------------------------------

/** «HH:MM» или «HH:MM:SS» из базы → минуты от полуночи. */
export function minutesOf(time: string | null | undefined): number | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** Минуты от полуночи → «HH:MM» для патча и подписи. */
export function timeOf(minutes: number): string {
  const m = ((Math.round(minutes) % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

export function snapMinutes(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

/** Пара «день + минуты», приведённая к границам суток: минуты переносят день. */
function normalizePoint(day: string, minutes: number): { day: string; minutes: number } {
  const shift = Math.floor(minutes / MINUTES_IN_DAY);
  return { day: shift === 0 ? day : addDays(day, shift), minutes: minutes - shift * MINUTES_IN_DAY };
}

/**
 * Момент из базы (ISO в UTC) → местные день и минуты браузера.
 *
 * Единственное место модели, которое смотрит на часовой пояс, и смотрит
 * намеренно: внешнее событие — это миг, а полотно рисует местные сутки. Отсюда
 * же следствие, которое легко потерять: функция обязана вызываться в браузере.
 * На сервере зона процесса (UTC в контейнере) разошлась бы с зоной читателя, и
 * серверная разметка не совпала бы с браузерной.
 */
export function localPoint(iso: string): { day: string; minutes: number } {
  const d = new Date(iso);
  return {
    day: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    minutes: d.getHours() * 60 + d.getMinutes(),
  };
}

// --- Элемент полотна ---------------------------------------------------------------

export type CalendarItemKind = "task" | "event";

/** Какие даты у задачи заполнены — от этого зависит, что меняет жест. */
export type CalendarAnchor = "start_date" | "due_date" | "both";

export interface CalendarItem {
  /** Ключ на полотне: id задачи и id события независимы, отсюда префикс. */
  key: string;
  kind: CalendarItemKind;
  id: string;
  title: string;
  /**
   * Полоса по дням, а не блок в часовой сетке. Так лежит и «весь день», и всё
   * многодневное: сетка часов описывает одни сутки, и растянуть по ней задачу
   * с 29-го по 31-е нельзя — она превратилась бы в три несвязанных обрезка.
   */
  bar: boolean;
  /** Время задано пользователем и показывается в подписи. */
  timed: boolean;
  /** Первый и последний день включительно. */
  startDay: string;
  endDay: string;
  /** Минуты от полуночи `startDay`/`endDay`. Осмысленны при `bar === false`. */
  startMinutes: number;
  endMinutes: number;
  /** Край нарисован по умолчанию, а не задан — рисуется пунктиром. */
  inferredStart: boolean;
  inferredEnd: boolean;
  /** Конец раньше начала: показываем как есть и помечаем, а не переворачиваем. */
  invalid: boolean;
  /** Цвет полосы: у задачи — её статуса, у события — его календаря. */
  color: string | null;
  done: boolean;
  overdue: boolean;
  /** Какие поля задачи держат края. У события полей нет — `both` не читается. */
  anchor: CalendarAnchor;
  /** Внешнее событие правится только в своём календаре. */
  editable: boolean;
}

/**
 * Задача на полотне или `null`, если дат нет вовсе: такие задачи живут отдельной
 * секцией и появляются на сетке, когда им назначат день, — ровно как на ганте.
 *
 * Правила, по которым выбирается вид:
 *
 *  1. Дни начала и конца разные → полоса по дням. Время, если задано, уходит в
 *     подпись: часовая сетка про одни сутки, и многодневному в ней места нет.
 *  2. День один, времени нет ни у начала, ни у срока → плашка «весь день».
 *  3. День один и есть хотя бы одно время → блок в часовой сетке. Недостающий
 *     край берётся как `DEFAULT_SLOT_MINUTES` от заданного и помечается
 *     выведенным: длительность, которой никто не назначал, нельзя показывать
 *     так же, как настоящую.
 */
export function taskItem(task: TaskRow, today: string, color: string | null = null): CalendarItem | null {
  const { start_date: startDate, due_date: dueDate } = task;
  if (!startDate && !dueDate) return null;

  const done = !!task.completed_at;
  const overdue = !done && !!dueDate && dueDate < today;
  const anchor: CalendarAnchor = startDate && dueDate ? "both" : startDate ? "start_date" : "due_date";

  const rawStart = startDate ?? dueDate!;
  const rawEnd = dueDate ?? startDate!;
  // Начало позже срока схема не запрещает (0044). Полосу сводим к одному дню —
  // дню срока — и помечаем: молча переворачивать чужой план нельзя, ровно так же
  // поступает `barOf` ганта.
  const daysInverted = rawEnd < rawStart;
  const startDay = daysInverted ? rawEnd : rawStart;
  const endDay = rawEnd;

  const base = {
    key: `task:${task.id}`,
    kind: "task" as const,
    id: task.id,
    title: task.title,
    color,
    done,
    overdue,
    anchor,
    editable: true,
  };

  if (startDay !== endDay) {
    const st = minutesOf(task.start_time);
    const en = minutesOf(task.due_time);
    return {
      ...base,
      bar: true,
      timed: st != null || en != null,
      startDay,
      endDay,
      startMinutes: st ?? 0,
      endMinutes: en ?? MINUTES_IN_DAY,
      // У полосы по дням пометка означает не «мы придумали длительность», а
      // «времени с этой стороны не задали» — от этого зависит подпись: задача с
      // 22-го по 27-е и сроком в 11:05 подписана «до 11:05», а не
      // «00:00 — 11:05», потому что полночь ей никто не назначал.
      inferredStart: st == null,
      inferredEnd: en == null,
      invalid: daysInverted,
    };
  }

  // Один день: время у начала и у срока относится к нему же.
  const st = minutesOf(task.start_time);
  const en = minutesOf(task.due_time);
  if (st == null && en == null) {
    return {
      ...base,
      bar: true,
      timed: false,
      startDay,
      endDay,
      startMinutes: 0,
      endMinutes: MINUTES_IN_DAY,
      inferredStart: false,
      inferredEnd: false,
      invalid: daysInverted,
    };
  }

  const inferredStart = st == null;
  const inferredEnd = en == null || en <= (st ?? 0);
  const startMinutes = st ?? Math.max(0, en! - DEFAULT_SLOT_MINUTES);
  const endMinutes = inferredEnd ? Math.min(MINUTES_IN_DAY, startMinutes + DEFAULT_SLOT_MINUTES) : en!;

  return {
    ...base,
    bar: false,
    timed: true,
    startDay,
    endDay,
    startMinutes,
    endMinutes,
    inferredStart,
    inferredEnd,
    // Время конца раньше времени начала — то же состояние «поправьте руками»,
    // что и перевёрнутые дни.
    invalid: daysInverted || (st != null && en != null && en <= st),
  };
}

/**
 * Внешнее событие на полотне. Правке не подлежит: наши таблицы — кэш чужого
 * источника, и полоса, которую можно потянуть, обещала бы запись туда, которой
 * нет.
 *
 * Событие, кончающееся ровно в полночь, принадлежит предыдущему дню: встреча
 * «22:00 — 00:00» иначе оставляла бы пустой обрезок в следующих сутках.
 */
export function eventItem(event: CalendarEventRow, color: string | null = null): CalendarItem | null {
  const base = {
    key: `event:${event.id}`,
    kind: "event" as const,
    id: event.id,
    title: event.title || "Без названия",
    color,
    done: false,
    overdue: false,
    inferredStart: false,
    inferredEnd: false,
    invalid: false,
    anchor: "both" as const,
    editable: false,
  };

  if (event.all_day) {
    if (!event.start_date || !event.end_date) return null;
    return {
      ...base,
      bar: true,
      timed: false,
      startDay: event.start_date,
      endDay: event.end_date < event.start_date ? event.start_date : event.end_date,
      startMinutes: 0,
      endMinutes: MINUTES_IN_DAY,
    };
  }

  if (!event.starts_at || !event.ends_at) return null;
  const from = localPoint(event.starts_at);
  const rawTo = localPoint(event.ends_at);
  const to =
    rawTo.minutes === 0 && rawTo.day > from.day
      ? { day: addDays(rawTo.day, -1), minutes: MINUTES_IN_DAY }
      : rawTo;

  if (to.day !== from.day) {
    return {
      ...base,
      bar: true,
      timed: true,
      startDay: from.day,
      endDay: to.day < from.day ? from.day : to.day,
      startMinutes: from.minutes,
      endMinutes: to.minutes,
    };
  }

  return {
    ...base,
    bar: false,
    timed: true,
    startDay: from.day,
    endDay: from.day,
    startMinutes: from.minutes,
    endMinutes: Math.max(to.minutes, from.minutes),
  };
}

/** Пересекается ли элемент с днём. */
export function coversDay(item: CalendarItem, day: string): boolean {
  return item.startDay <= day && item.endDay >= day;
}

/** Элементы, попадающие в окно. */
export function itemsInRange(items: readonly CalendarItem[], range: DayRange): CalendarItem[] {
  return items.filter((i) => i.endDay >= range.from && i.startDay <= range.to);
}

// --- Раскладка полос по дорожкам ---------------------------------------------------

export interface BarLayout {
  item: CalendarItem;
  /** Индекс дня в строке, с которого рисуем. */
  offset: number;
  /** Сколько дней строки занимает. */
  span: number;
  /** Номер дорожки: полосы одной дорожки по дням не пересекаются. */
  lane: number;
  /** Продолжается за краем строки — рисуем срез вместо скругления. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * Полосы одной строки сетки, разложенные по дорожкам сверху вниз.
 *
 * Жадный алгоритм по интервальному графу: полоса встаёт в первую дорожку,
 * которая к её началу освободилась. Порядок — по дню начала, длинные выше:
 * многодневное поверх однодневного читается как слои, обратное — как каша.
 */
export function layoutBars(items: readonly CalendarItem[], days: readonly string[]): BarLayout[] {
  if (days.length === 0) return [];
  const first = days[0];
  const last = days[days.length - 1];

  const visible = items.filter((i) => i.bar && i.endDay >= first && i.startDay <= last);
  const sorted = [...visible].sort((a, b) => {
    if (a.startDay !== b.startDay) return a.startDay < b.startDay ? -1 : 1;
    const lenA = diffDays(a.startDay, a.endDay);
    const lenB = diffDays(b.startDay, b.endDay);
    if (lenA !== lenB) return lenB - lenA;
    return a.key.localeCompare(b.key);
  });

  /** Последний занятый индекс дня в каждой дорожке. */
  const laneEnd: number[] = [];
  const out: BarLayout[] = [];

  for (const item of sorted) {
    const offset = Math.max(0, diffDays(first, item.startDay));
    const endIndex = Math.min(days.length - 1, diffDays(first, item.endDay));
    let lane = laneEnd.findIndex((end) => end < offset);
    if (lane < 0) {
      lane = laneEnd.length;
      laneEnd.push(-1);
    }
    laneEnd[lane] = endIndex;
    out.push({
      item,
      offset,
      span: endIndex - offset + 1,
      lane,
      clippedStart: item.startDay < first,
      clippedEnd: item.endDay > last,
    });
  }

  return out;
}

/** Сколько дорожек занял ряд полос. */
export function laneCount(bars: readonly BarLayout[]): number {
  return bars.reduce((n, b) => Math.max(n, b.lane + 1), 0);
}

// --- Раскладка блоков в часовой сетке ----------------------------------------------

export interface BlockLayout {
  item: CalendarItem;
  /** Колонка внутри группы пересекающихся и сколько их всего в группе. */
  column: number;
  columns: number;
}

/**
 * Блоки одного дня, разложенные по колонкам, как в Google Calendar: сначала
 * пересекающиеся собираются в группу (пересечение транзитивно — A с B, B с C, и
 * все трое делят ширину), внутри группы каждый занимает первую освободившуюся
 * колонку.
 *
 * Ширина считается по группе, а не по всему дню: две встречи утром не должны
 * ужиматься вдвое из-за того, что вечером пересеклись ещё две.
 */
export function layoutDay(items: readonly CalendarItem[], day: string): BlockLayout[] {
  const list = items
    .filter((i) => !i.bar && i.startDay === day)
    .map((item) => ({
      item,
      start: item.startMinutes,
      // Пол длительности — иначе соседний блок считает место под коротким
      // событием свободным и наезжает на него.
      end: Math.max(item.endMinutes, item.startMinutes + MIN_BLOCK_MINUTES),
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.item.key.localeCompare(b.item.key));

  const out: BlockLayout[] = [];
  let group: Array<{ item: CalendarItem; column: number }> = [];
  let columnEnd: number[] = [];

  const flush = () => {
    const columns = Math.max(1, columnEnd.length);
    for (const entry of group) out.push({ item: entry.item, column: entry.column, columns });
    group = [];
    columnEnd = [];
  };

  for (const entry of list) {
    // Ни одна колонка не занята к этому моменту — предыдущая группа закрыта.
    if (group.length > 0 && columnEnd.every((end) => end <= entry.start)) flush();
    let column = columnEnd.findIndex((end) => end <= entry.start);
    if (column < 0) {
      column = columnEnd.length;
      columnEnd.push(0);
    }
    columnEnd[column] = entry.end;
    group.push({ item: entry.item, column });
  }
  flush();

  return out;
}

// --- Жесты -------------------------------------------------------------------------

export type CalendarDragKind = "move" | "resize-start" | "resize-end";

/** То, что уходит в PATCH задачи. Отсутствующее поле означает «не трогали». */
export interface TaskDatesPatch {
  start_date?: string | null;
  start_time?: string | null;
  due_date?: string | null;
  due_time?: string | null;
}

/**
 * Новые даты задачи после жеста, сдвинутого на `days` дней и `minutes` минут.
 *
 * Три правила, которые легко потерять обратной правкой:
 *
 *  1. **Выведенный край не превращается в записанный сам собой.** У задачи с
 *     одним временем полотно рисует час; сдвиг такой полосы меняет только
 *     заданный край, а `due_time` остаётся пустым. Иначе простое перетаскивание
 *     молча дописывало бы задаче длительность, которую никто не назначал.
 *  2. **Растягивание задаёт недостающий край.** Потянув низ такого блока,
 *     человек как раз и назначает конец — тогда `due_date`/`due_time`
 *     проставляются, и правило 1 к задаче больше не применяется.
 *  3. **Полоса не выворачивается наизнанку.** Край упирается в
 *     противоположный, как в `dragBar` ганта: рывок мышью на пол-экрана не
 *     должен делать задачу, которая кончается раньше, чем началась.
 */
export function dragItem(
  item: CalendarItem,
  kind: CalendarDragKind,
  delta: { days: number; minutes: number },
): TaskDatesPatch {
  if (!item.editable) return {};
  // Прижимаем ДО проверки на пустой жест: сдвиг на семь минут это ноль по сетке
  // в четверть часа, и патч «то же самое, что было» уходить на сервер не должен.
  const minutes = item.bar ? 0 : snapMinutes(delta.minutes);
  if (delta.days === 0 && minutes === 0) return {};

  return item.bar ? dragBarItem(item, kind, delta.days) : dragBlockItem(item, kind, { days: delta.days, minutes });
}

/** Полоса по дням: время не участвует, двигаются только даты. */
function dragBarItem(item: CalendarItem, kind: CalendarDragKind, days: number): TaskDatesPatch {
  if (days === 0) return {};

  // Заполнена одна дата: полоса занимает один день. Перемещение двигает эту
  // дату, а растягивание заводит вторую — именно так однодневная задача
  // становится отрезком, и другого способа задать его мышью нет.
  if (item.anchor === "start_date") {
    const day = item.startDay;
    const moved = addDays(day, days);
    if (kind === "move") return { start_date: moved };
    if (kind === "resize-end") return { due_date: moved < day ? day : moved };
    return { start_date: moved > day ? day : moved, due_date: day };
  }
  if (item.anchor === "due_date") {
    const day = item.startDay;
    const moved = addDays(day, days);
    if (kind === "move") return { due_date: moved };
    if (kind === "resize-start") return { start_date: moved > day ? day : moved };
    return { start_date: day, due_date: moved < day ? day : moved };
  }

  if (kind === "move") {
    return { start_date: addDays(item.startDay, days), due_date: addDays(item.endDay, days) };
  }
  if (kind === "resize-start") {
    const next = addDays(item.startDay, days);
    return { start_date: next > item.endDay ? item.endDay : next };
  }
  const next = addDays(item.endDay, days);
  return { due_date: next < item.startDay ? item.startDay : next };
}

/** Блок в часовой сетке: двигаются и дата, и время. */
function dragBlockItem(
  item: CalendarItem,
  kind: CalendarDragKind,
  delta: { days: number; minutes: number },
): TaskDatesPatch {
  const shiftMinutes = delta.minutes;

  if (kind === "move") {
    const duration = item.endMinutes - item.startMinutes;
    const from = normalizePoint(addDays(item.startDay, delta.days), item.startMinutes + shiftMinutes);
    const to = normalizePoint(from.day, from.minutes + duration);
    const patch: TaskDatesPatch = {};
    // Заданные края переезжают целиком, выведенные не записываются: см. правило 1.
    if (item.anchor !== "due_date") {
      patch.start_date = from.day;
      if (!item.inferredStart) patch.start_time = timeOf(from.minutes);
    }
    if (item.anchor !== "start_date") {
      patch.due_date = to.day;
      if (!item.inferredEnd) patch.due_time = timeOf(to.minutes);
    }
    return patch;
  }

  if (kind === "resize-start") {
    const raw = normalizePoint(item.startDay, snapMinutes(item.startMinutes + shiftMinutes));
    // Верх не переезжает ниже низа: минимальный блок остаётся видимым.
    const limit = normalizePoint(item.endDay, item.endMinutes - SNAP_MINUTES);
    const capped =
      raw.day > limit.day || (raw.day === limit.day && raw.minutes > limit.minutes) ? limit : raw;
    return { start_date: capped.day, start_time: timeOf(capped.minutes) };
  }

  const raw = normalizePoint(item.endDay, snapMinutes(item.endMinutes + shiftMinutes));
  const limit = normalizePoint(item.startDay, item.startMinutes + SNAP_MINUTES);
  const capped =
    raw.day < limit.day || (raw.day === limit.day && raw.minutes < limit.minutes) ? limit : raw;
  return { due_date: capped.day, due_time: timeOf(capped.minutes) };
}

/**
 * Черновик задачи из выделенного на полотне слота. Клик по пустому месту в
 * часовой сетке даёт `DEFAULT_SLOT_MINUTES`, протяжка — то, что выделили;
 * в месяце и в полосе «весь день» времени нет вовсе, и задача рождается
 * однодневной.
 */
export function slotDraft(
  day: string,
  span: { startMinutes: number; endMinutes: number } | null,
): TaskDatesPatch {
  if (!span) return { start_date: day, start_time: null, due_date: day, due_time: null };
  const from = snapMinutes(Math.min(span.startMinutes, span.endMinutes));
  const rawTo = snapMinutes(Math.max(span.startMinutes, span.endMinutes));
  const to = Math.min(MINUTES_IN_DAY, Math.max(rawTo, from + SNAP_MINUTES));
  const end = normalizePoint(day, to);
  return {
    start_date: day,
    start_time: timeOf(from),
    due_date: end.day,
    due_time: timeOf(end.minutes),
  };
}

/**
 * Подпись времени. Показывает только то, что задано: незаданный край не
 * превращается ни в полночь, ни в «плюс час» — иначе подпись обещает
 * длительность, которой никто не назначал.
 */
export function itemTimeLabel(item: CalendarItem): string | null {
  if (!item.timed) return null;

  if (item.bar) {
    if (item.inferredStart && item.inferredEnd) return null;
    if (item.inferredStart) return `до ${timeOf(item.endMinutes)}`;
    if (item.inferredEnd) return `с ${timeOf(item.startMinutes)}`;
    return `${timeOf(item.startMinutes)} — ${timeOf(item.endMinutes)}`;
  }

  // Блок в часовой сетке уже стоит на своём месте, поэтому у него достаточно
  // одного конца: заданного.
  if (item.inferredEnd) return timeOf(item.startMinutes);
  if (item.inferredStart) return `до ${timeOf(item.endMinutes)}`;
  return `${timeOf(item.startMinutes)} — ${timeOf(item.endMinutes)}`;
}
