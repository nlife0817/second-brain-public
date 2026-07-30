// Разбор iCalendar (RFC 5545) для подписки на .ics-ссылку: Outlook, Яндекс,
// Apple, расписания вузов и всё остальное, что умеет отдавать календарь файлом.
//
// Чистые функции без сети и без базы — их проверяют тесты, а `calendars.ts`
// только скачивает текст и складывает результат.
//
// Почему свой разбор, а не библиотека: единственная зависимость, которую пришлось
// бы тянуть, весит больше всего остального модуля вместе с тестами, а нужен нам
// узкий срез формата — события в окне. Границу этого среза важно знать:
//
//  * поддерживаются VEVENT с DTSTART/DTEND/DURATION, повторы RRULE
//    (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY,
//    BYMONTH), исключения EXDATE и переопределения отдельных экземпляров
//    (RECURRENCE-ID);
//  * НЕ поддерживаются VTODO, VJOURNAL, VFREEBUSY, VALARM, а из RRULE —
//    BYSETPOS, BYWEEKNO, BYYEARDAY, BYHOUR/BYMINUTE и WKST, отличный от
//    понедельника. Такие правила разворачиваются по остальным своим частям, то
//    есть могут дать лишние экземпляры — но не теряют настоящие;
//  * повтор разворачивается только внутри окна и с потолком на серию: подписка
//    с ежедневным событием «навсегда» не должна превращаться в бесконечный цикл.
//
// Время: RRULE применяется к СТЕННЫМ часам DTSTART, а не к моменту, поэтому
// разворот идёт по календарным дням в зоне события, и лишь каждый готовый
// экземпляр переводится в момент (`wallToInstant`). Обратный порядок ломается на
// переходе на зимнее время: встреча «каждый день в 10:00» осталась бы в 09:00.

import { addDays, diffDays, startOfWeek, weekday } from "./days";
import type { ExternalEvent } from "./google-calendar";

/** Сколько экземпляров максимум даёт одна серия. */
const MAX_INSTANCES_PER_SERIES = 400;
/** Сколько дней максимум просматривается при развороте одной серии. */
const MAX_SCAN_DAYS = 20_000;
/** Потолок на весь календарь: подписка не должна ронять синхронизацию объёмом. */
const MAX_EVENTS = 5_000;

export interface IcsCalendar {
  /** X-WR-CALNAME, если есть: иначе имя придётся брать из ссылки. */
  name: string | null;
  /** X-WR-TIMEZONE — зона «плавающих» дат, у которых нет ни TZID, ни Z. */
  timezone: string | null;
  events: ExternalEvent[];
  /** Что в файле встретилось, но разобрано не было — уходит в предупреждение. */
  skipped: number;
}

// --- Лексика формата ---------------------------------------------------------------

/**
 * Развёртка строк: продолжение помечается пробелом или табуляцией в начале.
 * Делать это надо ДО разбора, иначе длинное описание разъедется по свойствам.
 */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/**
 * `NAME;PARAM=VAL;OTHER="a:b":значение` → части.
 *
 * Двоеточие внутри кавычек границей не считается: `ORGANIZER;CN="Ivanov: boss":`
 * встречается в реальных выгрузках, и наивный `split(":")` рвал бы такую строку
 * по параметру.
 */
function parseLine(line: string): ContentLine | null {
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let current = "";
  quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ";" && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);

  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

/** Экранирование TEXT: перевод строки, запятая, точка с запятой, слэш. */
function unescapeText(value: string): string {
  return value
    .replace(/\\[nN]/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

// --- Время -------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Смещение зоны в указанный момент. Неизвестная зона — считаем UTC. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(instantMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24,
      get("minute"),
      get("second"),
    );
    return asUtc - instantMs;
  } catch {
    return 0;
  }
}

interface WallTime {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/**
 * Стенные часы в зоне → момент.
 *
 * Смещение зависит от самого момента (переход на летнее время), поэтому берётся
 * в два приближения: первое считает смещение в «наивной» точке, второе — в уже
 * поправленной. Этого достаточно для всех настоящих зон: смещение меняется не
 * чаще двух раз в год и не больше чем на час-два.
 */
function wallToInstant(wall: WallTime, timeZone: string | null): number {
  const naive = Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s);
  if (!timeZone) return naive;
  const first = naive - zoneOffsetMs(naive, timeZone);
  return naive - zoneOffsetMs(first, timeZone);
}

interface IcsDate {
  /** Дата без времени — «весь день». */
  dateOnly: boolean;
  wall: WallTime;
  /** Зона стенных часов; `null` — плавающее время или UTC (см. `utc`). */
  timeZone: string | null;
  utc: boolean;
}

/** `20260730`, `20260730T100000`, `20260730T070000Z`. */
function parseIcsDate(line: ContentLine, fallbackZone: string | null): IcsDate | null {
  const value = line.value.trim();
  const dateOnly = line.params.VALUE === "DATE" || /^\d{8}$/.test(value);
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!m) return null;
  const wall: WallTime = {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4] ?? "0"),
    mi: Number(m[5] ?? "0"),
    s: Number(m[6] ?? "0"),
  };
  const utc = m[7] === "Z";
  const tzid = line.params.TZID ?? null;
  return {
    dateOnly,
    wall,
    // У «весь день» зоны нет по определению: это дни, а не моменты.
    timeZone: dateOnly || utc ? null : (tzid ?? fallbackZone),
    utc,
  };
}

function isoDayOf(wall: WallTime): string {
  return `${wall.y}-${pad2(wall.mo)}-${pad2(wall.d)}`;
}

function wallOfDay(day: string, from: WallTime): WallTime {
  return { y: Number(day.slice(0, 4)), mo: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)), h: from.h, mi: from.mi, s: from.s };
}

/** `PT1H30M`, `P2D`, `-PT15M`. Возвращает миллисекунды. */
function parseDuration(value: string): number | null {
  const m = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const ms =
    Number(m[2] ?? 0) * 604_800_000 +
    Number(m[3] ?? 0) * 86_400_000 +
    Number(m[4] ?? 0) * 3_600_000 +
    Number(m[5] ?? 0) * 60_000 +
    Number(m[6] ?? 0) * 1000;
  return m[1] === "-" ? -ms : ms;
}

// --- Правило повтора -----------------------------------------------------------------

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

interface Rrule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  /** Стенной день, после которого повтор кончается (включительно). */
  untilDay: string | null;
  /** Дни недели: 0 — понедельник. */
  byDay: number[];
  /** Дни недели с порядком внутри месяца: `{ ordinal: 2, day: 1 }` = второй вторник. */
  byDayOrdinal: Array<{ ordinal: number; day: number }>;
  byMonthDay: number[];
  byMonth: number[];
}

function parseRrule(value: string): Rrule | null {
  const parts = new Map<string, string>();
  for (const chunk of value.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq > 0) parts.set(chunk.slice(0, eq).toUpperCase(), chunk.slice(eq + 1));
  }
  const freq = parts.get("FREQ")?.toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;

  const byDay: number[] = [];
  const byDayOrdinal: Array<{ ordinal: number; day: number }> = [];
  for (const token of (parts.get("BYDAY") ?? "").split(",")) {
    const m = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(token.trim());
    if (!m) continue;
    const day = WEEKDAY_CODES.indexOf(m[2].toUpperCase());
    if (m[1]) byDayOrdinal.push({ ordinal: Number(m[1]), day });
    else byDay.push(day);
  }

  const numbers = (key: string): number[] =>
    (parts.get(key) ?? "")
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v !== 0);

  const until = parts.get("UNTIL");
  const count = Number(parts.get("COUNT"));

  return {
    freq,
    interval: Math.max(1, Number(parts.get("INTERVAL") ?? 1) || 1),
    count: Number.isFinite(count) && count > 0 ? count : null,
    // UNTIL может быть и датой, и моментом; для отбора по дням хватает дня.
    untilDay: until && /^\d{8}/.test(until) ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}` : null,
    byDay,
    byDayOrdinal,
    byMonthDay: numbers("BYMONTHDAY"),
    byMonth: numbers("BYMONTH"),
  };
}

function monthLength(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function monthsBetween(from: string, to: string): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
}

/** Совпадает ли день с правилом. Позиция серии считается от дня DTSTART. */
function dayMatches(rule: Rrule, startDay: string, day: string): boolean {
  const dom = Number(day.slice(8, 10));
  const month = Number(day.slice(5, 7));
  const year = Number(day.slice(0, 4));

  const monthDayOk = () => {
    if (rule.byMonthDay.length === 0) return null;
    const len = monthLength(year, month);
    return rule.byMonthDay.some((v) => (v > 0 ? v === dom : len + v + 1 === dom));
  };

  const ordinalOk = () => {
    if (rule.byDayOrdinal.length === 0) return null;
    const wd = weekday(day);
    return rule.byDayOrdinal.some((entry) => {
      if (entry.day !== wd) return false;
      if (entry.ordinal > 0) return Math.floor((dom - 1) / 7) + 1 === entry.ordinal;
      const len = monthLength(year, month);
      return Math.floor((len - dom) / 7) + 1 === -entry.ordinal;
    });
  };

  switch (rule.freq) {
    case "DAILY":
      return diffDays(startDay, day) % rule.interval === 0;

    case "WEEKLY": {
      const weeks = diffDays(startOfWeek(startDay), startOfWeek(day)) / 7;
      if (!Number.isInteger(weeks) || weeks % rule.interval !== 0) return false;
      if (rule.byDay.length > 0) return rule.byDay.includes(weekday(day));
      return weekday(day) === weekday(startDay);
    }

    case "MONTHLY": {
      if (monthsBetween(startDay, day) % rule.interval !== 0) return false;
      const byOrdinal = ordinalOk();
      if (byOrdinal !== null) return byOrdinal;
      const byMonthDay = monthDayOk();
      if (byMonthDay !== null) return byMonthDay;
      return dom === Number(startDay.slice(8, 10));
    }

    case "YEARLY": {
      if ((year - Number(startDay.slice(0, 4))) % rule.interval !== 0) return false;
      const monthOk = rule.byMonth.length > 0 ? rule.byMonth.includes(month) : month === Number(startDay.slice(5, 7));
      if (!monthOk) return false;
      const byOrdinal = ordinalOk();
      if (byOrdinal !== null) return byOrdinal;
      const byMonthDay = monthDayOk();
      if (byMonthDay !== null) return byMonthDay;
      return dom === Number(startDay.slice(8, 10));
    }
  }
}

/**
 * Дни серии внутри окна.
 *
 * Просмотр идёт по дням, а не «шагами правила»: предикат на день короче и не
 * ошибается на краях месяцев, а цена — линейный проход, ограниченный окном и
 * потолком. Считать от DTSTART обязательно только при COUNT: там номер
 * экземпляра — часть правила, и начать с середины нельзя.
 */
function expandRule(
  rule: Rrule,
  startDay: string,
  window: { from: string; to: string },
): string[] {
  const end = rule.untilDay && rule.untilDay < window.to ? rule.untilDay : window.to;
  const out: string[] = [];

  let cursor = rule.count == null && startDay < window.from ? window.from : startDay;
  // Позиция в серии нужна только для COUNT — тогда и идём от начала.
  let emitted = 0;

  for (let i = 0; i < MAX_SCAN_DAYS && cursor <= end; i++, cursor = addDays(cursor, 1)) {
    if (cursor < startDay) continue;
    if (!dayMatches(rule, startDay, cursor)) continue;
    emitted++;
    if (rule.count != null && emitted > rule.count) break;
    if (cursor >= window.from) out.push(cursor);
    if (out.length >= MAX_INSTANCES_PER_SERIES) break;
  }

  return out;
}

// --- Сборка событий ------------------------------------------------------------------

interface RawEvent {
  uid: string;
  summary: string;
  description: string | null;
  location: string | null;
  status: string | null;
  organizer: string | null;
  updated: string | null;
  start: IcsDate;
  /** Длительность в миллисекундах (для событий со временем) или в днях. */
  durationMs: number;
  durationDays: number;
  rrule: Rrule | null;
  /** Дни-исключения (по стенному дню). */
  exdates: Set<string>;
  /** День экземпляра, который это событие переопределяет. */
  recurrenceDay: string | null;
}

function collectEvents(lines: string[], fallbackZone: string | null): { events: RawEvent[]; skipped: number } {
  const events: RawEvent[] = [];
  let skipped = 0;
  let current: ContentLine[] | null = null;
  /** Вложенные блоки (VALARM, VTIMEZONE) внутрь события не пускаем. */
  let nested = 0;

  for (const raw of lines) {
    const line = parseLine(raw);
    if (!line) continue;

    if (line.name === "BEGIN") {
      const kind = line.value.trim().toUpperCase();
      if (current) {
        nested++;
        continue;
      }
      if (kind === "VEVENT") current = [];
      else if (kind !== "VCALENDAR") skipped++;
      continue;
    }

    if (line.name === "END") {
      if (nested > 0) {
        nested--;
        continue;
      }
      if (current && line.value.trim().toUpperCase() === "VEVENT") {
        const event = buildRawEvent(current, fallbackZone);
        if (event) events.push(event);
        else skipped++;
        current = null;
      }
      continue;
    }

    if (current && nested === 0) current.push(line);
  }

  return { events, skipped };
}

function buildRawEvent(lines: ContentLine[], fallbackZone: string | null): RawEvent | null {
  const find = (name: string) => lines.find((l) => l.name === name);
  const startLine = find("DTSTART");
  if (!startLine) return null;
  const start = parseIcsDate(startLine, fallbackZone);
  if (!start) return null;

  const endLine = find("DTEND");
  const end = endLine ? parseIcsDate(endLine, fallbackZone) : null;
  const durationLine = find("DURATION");

  let durationMs = 0;
  let durationDays = start.dateOnly ? 1 : 0;

  if (end) {
    if (start.dateOnly) {
      // DTEND у «весь день» исключительный: событие «по 31-е» кончается 30-го.
      durationDays = Math.max(1, diffDays(isoDayOf(start.wall), isoDayOf(end.wall)));
    } else {
      durationMs = Math.max(0, wallToInstant(end.wall, end.timeZone) - wallToInstant(start.wall, start.timeZone));
    }
  } else if (durationLine) {
    const parsed = parseDuration(durationLine.value);
    if (parsed != null && parsed > 0) {
      if (start.dateOnly) durationDays = Math.max(1, Math.round(parsed / 86_400_000));
      else durationMs = parsed;
    }
  }

  const exdates = new Set<string>();
  for (const line of lines.filter((l) => l.name === "EXDATE")) {
    for (const chunk of line.value.split(",")) {
      const parsed = parseIcsDate({ ...line, value: chunk }, fallbackZone);
      if (parsed) exdates.add(isoDayOf(parsed.wall));
    }
  }

  const recurrenceLine = find("RECURRENCE-ID");
  const recurrence = recurrenceLine ? parseIcsDate(recurrenceLine, fallbackZone) : null;
  const rruleLine = find("RRULE");

  return {
    uid: find("UID")?.value.trim() || "",
    summary: unescapeText(find("SUMMARY")?.value ?? ""),
    description: find("DESCRIPTION") ? unescapeText(find("DESCRIPTION")!.value) : null,
    location: find("LOCATION") ? unescapeText(find("LOCATION")!.value) : null,
    status: find("STATUS")?.value.trim().toLowerCase() ?? null,
    organizer: organizerOf(find("ORGANIZER")),
    updated: momentOf(find("LAST-MODIFIED") ?? find("DTSTAMP"), fallbackZone),
    start,
    durationMs,
    durationDays,
    rrule: rruleLine ? parseRrule(rruleLine.value) : null,
    exdates,
    recurrenceDay: recurrence ? isoDayOf(recurrence.wall) : null,
  };
}

function organizerOf(line: ContentLine | undefined): string | null {
  if (!line) return null;
  const cn = line.params.CN;
  if (cn) return unescapeText(cn);
  const value = line.value.trim();
  return value ? value.replace(/^mailto:/i, "") : null;
}

function momentOf(line: ContentLine | undefined, fallbackZone: string | null): string | null {
  if (!line) return null;
  const parsed = parseIcsDate(line, fallbackZone);
  if (!parsed) return null;
  return new Date(wallToInstant(parsed.wall, parsed.timeZone)).toISOString();
}

/** Экземпляр серии или одиночное событие → строка для `core.calendar_events`. */
function toExternalEvent(event: RawEvent, day: string, isInstance: boolean): ExternalEvent {
  // id экземпляра включает день: серия ложится отдельными строками, и без дня
  // они схлопнулись бы в одну по уникальному индексу.
  const externalId = isInstance ? `${event.uid}@${day}` : event.uid;
  const base = {
    externalId,
    title: event.summary,
    description: event.description,
    location: event.location,
    status: event.status,
    organizer: event.organizer,
    htmlLink: null,
    externalUpdatedAt: event.updated,
  };

  if (event.start.dateOnly) {
    return {
      ...base,
      allDay: true,
      startDate: day,
      endDate: addDays(day, Math.max(0, event.durationDays - 1)),
      startsAt: null,
      endsAt: null,
    };
  }

  const startMs = wallToInstant(wallOfDay(day, event.start.wall), event.start.timeZone);
  return {
    ...base,
    allDay: false,
    startDate: null,
    endDate: null,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(startMs + event.durationMs).toISOString(),
  };
}

/**
 * Разбор файла подписки.
 *
 * `window` ограничивает разворот повторов и отсев одиночных событий: подписка
 * может содержать десять лет истории, а календарь показывает окно вокруг
 * сегодняшнего дня.
 */
export function parseIcs(text: string, window: { from: string; to: string }): IcsCalendar {
  const lines = unfold(text);

  let name: string | null = null;
  let timezone: string | null = null;
  for (const raw of lines) {
    const line = parseLine(raw);
    if (!line) continue;
    if (line.name === "X-WR-CALNAME" && !name) name = unescapeText(line.value.trim()) || null;
    if (line.name === "X-WR-TIMEZONE" && !timezone) timezone = line.value.trim() || null;
    if (line.name === "BEGIN" && line.value.trim().toUpperCase() === "VEVENT") break;
  }

  const { events: raws, skipped } = collectEvents(lines, timezone);

  // Переопределения отдельных экземпляров: по UID и дню, который они заменяют.
  const overrides = new Map<string, RawEvent>();
  for (const event of raws) {
    if (event.recurrenceDay) overrides.set(`${event.uid} ${event.recurrenceDay}`, event);
  }

  const out: ExternalEvent[] = [];
  const seen = new Set<string>();
  const push = (event: ExternalEvent) => {
    if (seen.has(event.externalId) || out.length >= MAX_EVENTS) return;
    seen.add(event.externalId);
    out.push(event);
  };

  for (const event of raws) {
    if (!event.uid) continue;
    // Переопределения разбираются вместе со своей серией, отдельной строкой им
    // быть незачем: иначе тот же экземпляр окажется на полотне дважды.
    if (event.recurrenceDay) continue;

    if (!event.rrule) {
      const day = isoDayOf(event.start.wall);
      const lastDay = event.start.dateOnly ? addDays(day, Math.max(0, event.durationDays - 1)) : day;
      if (lastDay < window.from || day > window.to) continue;
      push(toExternalEvent(event, day, false));
      continue;
    }

    for (const day of expandRule(event.rrule, isoDayOf(event.start.wall), window)) {
      if (event.exdates.has(day)) continue;
      const override = overrides.get(`${event.uid} ${day}`);
      if (override) {
        // Переопределение могло переехать на другой день — берём его собственный.
        const movedDay = isoDayOf(override.start.wall);
        if (override.status === "cancelled") continue;
        push(toExternalEvent({ ...override, uid: event.uid }, movedDay, true));
        continue;
      }
      push(toExternalEvent(event, day, true));
    }
  }

  return { name, timezone, events: out, skipped };
}
