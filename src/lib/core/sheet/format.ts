// Числовые форматы и разбор того, что человек напечатал в ячейке.
//
// Формат в ячейке хранится не строкой Excel, а одним из перечисленных ниже
// кодов. Полный язык форматов Excel («_-* #,##0.00_-;-* #,##0.00_-;…») никто
// вручную не пишет, зато его разбор — источник бесконечных краевых случаев;
// при импорте чужой код приводится к ближайшему нашему (`normalizeNumFmt`), а
// при выгрузке разворачивается обратно.
//
// Даты — эксель-серийные числа (см. functions.ts). Поэтому «дата» это не тип
// значения, а формат его показа: разность дат считается вычитанием, а ячейка
// без формата покажет число — ровно как в Excel.

import { serialToDate, dateToSerial, shiftDecimal } from "./functions";
import type { CellValue } from "./model";

/** Коды форматов, которые понимает редактор. Пусто — «общий». */
export const FORMATS = {
  general: "",
  integer: "0",
  decimal: "0.00",
  thousands: "# ##0",
  thousandsDecimal: "# ##0.00",
  percent: "0%",
  percentDecimal: "0.00%",
  rub: "# ##0.00 ₽",
  usd: "$# ##0.00",
  eur: "€# ##0.00",
  date: "ДД.ММ.ГГГГ",
  dateTime: "ДД.ММ.ГГГГ чч:мм",
  time: "чч:мм",
  text: "@",
} as const;

export type FormatCode = (typeof FORMATS)[keyof typeof FORMATS];

/** Подписи для выпадающего списка форматов. */
export const FORMAT_LABELS: Array<{ code: string; label: string; sample: string }> = [
  { code: FORMATS.general, label: "Общий", sample: "1234,5" },
  { code: FORMATS.integer, label: "Целое", sample: "1235" },
  { code: FORMATS.decimal, label: "Два знака", sample: "1234,50" },
  { code: FORMATS.thousands, label: "С разделителями", sample: "1 235" },
  { code: FORMATS.thousandsDecimal, label: "С разделителями, 2 знака", sample: "1 234,50" },
  { code: FORMATS.percent, label: "Проценты", sample: "12%" },
  { code: FORMATS.percentDecimal, label: "Проценты, 2 знака", sample: "12,34%" },
  { code: FORMATS.rub, label: "Рубли", sample: "1 234,50 ₽" },
  { code: FORMATS.usd, label: "Доллары", sample: "$1 234,50" },
  { code: FORMATS.eur, label: "Евро", sample: "€1 234,50" },
  { code: FORMATS.date, label: "Дата", sample: "31.08.2026" },
  { code: FORMATS.dateTime, label: "Дата и время", sample: "31.08.2026 14:30" },
  { code: FORMATS.time, label: "Время", sample: "14:30" },
  { code: FORMATS.text, label: "Текст", sample: "0123" },
];

export function isDateFormat(fmt: string | undefined): boolean {
  return parseFormat(fmt).kind === "date";
}

// --- Разбор кода формата ---------------------------------------------------
//
// Движок один на встроенные и свои коды: список из четырнадцати — это те же
// коды, только набранные заранее. Считать «свой формат» вторым способом значило
// бы, что «# ##0.000» показывается не так, как «# ##0.00», и разошлись бы они на
// первой же правке.
//
// Язык кода: `0` и `#` — знакоместа числа, точка отделяет дробную часть,
// пробел и запятая внутри целой части включают разделитель разрядов, `%`
// умножает на сто, `@` — текст, всё прочее вокруг числа показывается как есть.
// Буквы Д, М, Г, ч, м, с (и латинские D, M, Y, h, m, s) делают код датным.

export interface FormatSpec {
  kind: "general" | "number" | "date" | "text";
  decimals: number;
  grouped: boolean;
  percent: boolean;
  prefix: string;
  suffix: string;
  /** Исходный код: по нему рисуется дата. */
  pattern: string;
}

const BLANK_SPEC: FormatSpec = {
  kind: "general",
  decimals: 0,
  grouped: false,
  percent: false,
  prefix: "",
  suffix: "",
  pattern: "",
};

const DATE_LETTERS = /[ДМГЧСдмгчс]|[DMYHSdmyhs]/;

export function parseFormat(code: string | undefined): FormatSpec {
  const text = (code ?? "").trim();
  if (!text) return BLANK_SPEC;
  if (text === FORMATS.text) return { ...BLANK_SPEC, kind: "text", pattern: text };

  const first = text.search(/[0#]/);
  if (first < 0) {
    return DATE_LETTERS.test(text)
      ? { ...BLANK_SPEC, kind: "date", pattern: text }
      : { ...BLANK_SPEC, pattern: text };
  }

  let last = first;
  for (let i = text.length - 1; i >= first; i--) {
    if (text[i] === "0" || text[i] === "#") {
      last = i;
      break;
    }
  }

  const body = text.slice(first, last + 1);
  const tail = text.slice(last + 1);
  // Дробную часть отделяет только точка: запятая и пробел — разделители
  // разрядов, иначе «#,##0» читалось бы как три знака после запятой.
  const dot = body.lastIndexOf(".");
  const decimals = dot >= 0 ? body.length - dot - 1 : 0;
  const integer = dot >= 0 ? body.slice(0, dot) : body;

  return {
    kind: "number",
    decimals,
    grouped: /[ , ]/.test(integer),
    percent: text.includes("%"),
    // Кавычки вокруг приписки — способ записи Excel, а не часть текста: код,
    // скопированный оттуда, не должен показывать «1 234" шт."».
    prefix: unquote(text.slice(0, first)),
    suffix: unquote(tail),
    pattern: text,
  };
}

function unquote(text: string): string {
  return text.replace(/"/g, "").replace(/\\(.)/g, "$1");
}

/** Обратная сборка кода — ею работают кнопки «больше/меньше знаков». */
export function buildFormat(spec: FormatSpec): string {
  if (spec.kind !== "number") return spec.pattern;
  const integer = spec.grouped ? "# ##0" : "0";
  const fraction = spec.decimals > 0 ? `.${"0".repeat(spec.decimals)}` : "";
  return `${spec.prefix}${integer}${fraction}${spec.suffix}`;
}

/**
 * Код с другим числом знаков после запятой. Дата и текст остаются собой: у них
 * дробной части нет, и превращать их в число по нажатию кнопки — не то, чего
 * ждут.
 */
export function withDecimals(code: string | undefined, delta: number): string | undefined {
  const spec = parseFormat(code);
  if (spec.kind === "date" || spec.kind === "text") return code;
  const decimals = Math.max(0, Math.min(9, spec.decimals + delta));
  const next = buildFormat({ ...spec, kind: "number", decimals });
  return next || undefined;
}

// --- Показ -----------------------------------------------------------------

/** Значение ячейки → то, что видно в клетке. */
export function formatValue(value: CellValue, fmt?: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "ИСТИНА" : "ЛОЖЬ";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "#NUM!";

  const spec = parseFormat(fmt);
  switch (spec.kind) {
    case "number": {
      const scaled = spec.percent ? value * 100 : value;
      return `${spec.prefix}${fixed(scaled, spec.decimals, spec.grouped)}${spec.suffix}`;
    }
    case "date":
      return formatDate(value, spec.pattern);
    default:
      return generalNumber(value);
  }
}

/**
 * «Общий» формат: показываем число как есть, но без хвостов двоичной
 * арифметики (0,1 + 0,2 обязано выглядеть как 0,3) и без экспоненты там, где
 * без неё читается.
 */
function generalNumber(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const rounded = Number(value.toPrecision(12));
  const text = Math.abs(rounded) >= 1e15 || (Math.abs(rounded) < 1e-9 && rounded !== 0)
    ? rounded.toExponential(6)
    : String(rounded);
  return text.replace(".", ",");
}

function fixed(value: number, decimals: number, grouped: boolean): string {
  // Округляем тем же способом, что и функция ROUND: показ и вычисление обязаны
  // сходиться, иначе в ячейке 1,01, а в сумме по колонке — на копейку меньше.
  const rounded = shiftDecimal(Math.round(shiftDecimal(Math.abs(value), decimals)), -decimals);
  const text = rounded.toFixed(decimals);
  const [whole, fraction] = text.split(".");
  const head = grouped ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : whole;
  const sign = value < 0 ? "−" : "";
  return fraction ? `${sign}${head},${fraction}` : `${sign}${head}`;
}

const MONTHS_FULL = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

/**
 * Дата по коду. Регистр разделяет месяц и минуты — «ММ» это месяц, «мм» минуты,
 * как в самом привычном коде «ДД.ММ.ГГГГ чч:мм». Текст в кавычках остаётся
 * текстом: иначе «мая» в шаблоне превратилось бы в минуты.
 */
function formatDate(serial: number, pattern: string): string {
  const date = serialToDate(serial);
  if (Number.isNaN(date.getTime())) return "#NUM!";

  const day = date.getUTCDate();
  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const pad = (n: number) => String(n).padStart(2, "0");

  const replace = (part: string) =>
    part.replace(
      /ГГГГ|YYYY|ГГ|YY|ММММ|MMMM|МММ|MMM|ММ|MM|М|M|ДД|DD|Д|D|чч|hh|ч|h|мм|mm|м|m|сс|ss|с|s/g,
      (token) => {
        switch (token) {
          case "ГГГГ":
          case "YYYY":
            return String(year);
          case "ГГ":
          case "YY":
            return pad(year % 100);
          case "ММММ":
          case "MMMM":
            return MONTHS_FULL[month];
          case "МММ":
          case "MMM":
            return MONTHS_FULL[month].slice(0, 3);
          case "ММ":
          case "MM":
            return pad(month + 1);
          case "М":
          case "M":
            return String(month + 1);
          case "ДД":
          case "DD":
            return pad(day);
          case "Д":
          case "D":
            return String(day);
          case "чч":
          case "hh":
            return pad(hours);
          case "ч":
          case "h":
            return String(hours);
          case "мм":
          case "mm":
            return pad(minutes);
          case "м":
          case "m":
            return String(minutes);
          case "сс":
          case "ss":
            return pad(seconds);
          default:
            return String(seconds);
        }
      },
    );

  return pattern
    .split(/("[^"]*")/)
    .map((part) => (part.startsWith('"') ? part.slice(1, -1) : replace(part)))
    .join("");
}

/** Что показать в строке формул и при входе в ячейку — исходный ввод, а не показ. */
export function editText(value: CellValue, formula: string | undefined, fmt?: string): string {
  if (formula) return `=${formula}`;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && isDateFormat(fmt)) return formatValue(value, fmt);
  if (typeof value === "number") return String(value).replace(".", ",");
  if (typeof value === "boolean") return value ? "ИСТИНА" : "ЛОЖЬ";
  return value;
}

// --- Разбор ввода ----------------------------------------------------------

export interface ParsedInput {
  value: CellValue;
  /** Формула без «=», если человек её ввёл. */
  formula?: string;
  /** Формат, который напрашивается из ввода: «15%» — проценты, «31.08.2026» — дата. */
  fmt?: string;
}

const DATE_RE = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Строка из поля ввода → значение ячейки.
 *
 * Распознаём то же, что Excel: формулу, число (с запятой или точкой, с
 * пробелами-разделителями тысяч), процент, дату, время, логическое. Всё
 * остальное остаётся текстом — молча превращать «1/2» в дату мы не будем, это
 * главный источник ругани на таблицы.
 *
 * `keepText` включается форматом «@»: колонка с артикулами не должна терять
 * ведущие нули.
 */
export function parseInput(raw: string, keepText = false): ParsedInput {
  const text = raw.trim();
  if (!text) return { value: null };

  if (text.startsWith("=")) {
    const formula = text.slice(1).trim();
    return formula ? { value: null, formula } : { value: text };
  }

  if (keepText) return { value: raw };

  const upper = text.toUpperCase();
  if (upper === "ИСТИНА" || upper === "TRUE") return { value: true };
  if (upper === "ЛОЖЬ" || upper === "FALSE") return { value: false };

  const iso = ISO_RE.exec(text);
  if (iso) {
    const [, y, m, d, hh, mi, ss] = iso;
    return {
      value: dateToSerial(
        new Date(Date.UTC(+y, +m - 1, +d, +(hh ?? 0), +(mi ?? 0), +(ss ?? 0))),
      ),
      fmt: hh ? FORMATS.dateTime : FORMATS.date,
    };
  }

  const local = DATE_RE.exec(text);
  if (local) {
    const [, d, m, y, hh, mi, ss] = local;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const date = new Date(Date.UTC(year, +m - 1, +d, +(hh ?? 0), +(mi ?? 0), +(ss ?? 0)));
    // Проверяем, что дата не «переехала»: 31.02 в Excel не дата, а текст.
    if (date.getUTCMonth() === +m - 1 && date.getUTCDate() === +d) {
      return { value: dateToSerial(date), fmt: hh ? FORMATS.dateTime : FORMATS.date };
    }
  }

  const time = TIME_RE.exec(text);
  if (time) {
    const [, hh, mi, ss] = time;
    if (+hh < 24 && +mi < 60) {
      return { value: (+hh * 3600 + +mi * 60 + +(ss ?? 0)) / 86_400, fmt: FORMATS.time };
    }
  }

  const percent = /^([+-]?[\d\s ]*[.,]?\d+)\s*%$/.exec(text);
  if (percent) {
    const n = toNumeric(percent[1]);
    if (n !== null) {
      const decimals = /[.,]/.test(percent[1]) ? FORMATS.percentDecimal : FORMATS.percent;
      return { value: n / 100, fmt: decimals };
    }
  }

  const money = /^([+-]?[\d\s ]*[.,]?\d+)\s*(₽|руб\.?|\$|€)$|^(\$|€|₽)\s*([+-]?[\d\s ]*[.,]?\d+)$/i.exec(
    text,
  );
  if (money) {
    const n = toNumeric(money[1] ?? money[4] ?? "");
    const symbol = (money[2] ?? money[3] ?? "").toLowerCase();
    if (n !== null) {
      const fmt = symbol.startsWith("$")
        ? FORMATS.usd
        : symbol.startsWith("€")
          ? FORMATS.eur
          : FORMATS.rub;
      return { value: n, fmt };
    }
  }

  const numeric = toNumeric(text);
  if (numeric !== null) {
    // Ведущий ноль — это код, а не число: «007» и «+7 900…» должны остаться
    // текстом, иначе телефонные справочники в таблицах превращаются в кашу.
    if (/^0\d/.test(text) || text.startsWith("+")) return { value: raw };
    return { value: numeric };
  }

  return { value: raw };
}

/** «1 234,50» → 1234.5. `null` — не число. */
function toNumeric(text: string): number | null {
  const cleaned = text.replace(/[\s ]/g, "");
  if (!cleaned || !/^[+-]?(\d+([.,]\d+)?|[.,]\d+)([eE][+-]?\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Код формата из чужого файла → наш. Соответствие приблизительное и таким
 * задумано: важно сохранить смысл (деньги, проценты, дата), а не начертание.
 */
export function normalizeNumFmt(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const fmt = code.toLowerCase().trim();
  if (!fmt || fmt === "general" || fmt === "общий") return undefined;
  if (fmt === "@") return FORMATS.text;
  if (fmt.includes("%")) {
    const spec = parseFormat(stripExcel(code));
    return buildFormat({ ...spec, kind: "number", prefix: "", suffix: "%" });
  }
  if (/[dmyдмг]/.test(fmt) && /[/.\-]/.test(fmt)) {
    return /[hчs]/.test(fmt) ? FORMATS.dateTime : FORMATS.date;
  }
  if (/^\[?\$?h+.*m+/.test(fmt) || (/[hч]/.test(fmt) && /:/.test(fmt) && !/[dyдг]/.test(fmt))) {
    return FORMATS.time;
  }
  if (fmt.includes("₽") || fmt.includes("руб")) return FORMATS.rub;
  if (fmt.includes("$")) return FORMATS.usd;
  if (fmt.includes("€")) return FORMATS.eur;
  // Число оставляем как есть, с его разрядами и знаками: приводить «0.000» к
  // двум знакам значило бы округлять чужие данные на глазок.
  const spec = parseFormat(stripExcel(code));
  if (spec.kind !== "number") return undefined;
  return buildFormat({ ...spec, prefix: "", suffix: "" }) || undefined;
}

/** Убрать из чужого кода то, чего наш язык не знает: escape-и, кавычки, локаль. */
function stripExcel(code: string): string {
  return code
    .replace(/\[[^\]]*\]/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/_./g, "")
    .replace(/;.*$/, "");
}

/** Наш код → код для xlsx: файл должен открыться в Excel так же, как у нас. */
export function toExcelNumFmt(code: string | undefined): string | undefined {
  switch (code) {
    case FORMATS.integer:
      return "0";
    case FORMATS.decimal:
      return "0.00";
    case FORMATS.thousands:
      return "#,##0";
    case FORMATS.thousandsDecimal:
      return "#,##0.00";
    case FORMATS.percent:
      return "0%";
    case FORMATS.percentDecimal:
      return "0.00%";
    case FORMATS.rub:
      return '#,##0.00\\ "₽"';
    case FORMATS.usd:
      return '"$"#,##0.00';
    case FORMATS.eur:
      return '"€"#,##0.00';
    case FORMATS.date:
      return "dd.mm.yyyy";
    case FORMATS.dateTime:
      return "dd.mm.yyyy hh:mm";
    case FORMATS.time:
      return "hh:mm";
    case FORMATS.text:
      return "@";
    default:
      break;
  }

  // Свой код переводим: у Excel те же места под цифры, но запятая в разрядах и
  // латинские буквы в дате.
  const spec = parseFormat(code);
  if (spec.kind === "date") {
    return spec.pattern.replace(
      /ГГГГ|ГГ|ММММ|МММ|ММ|М|ДД|Д|чч|ч|мм|м|сс|с/g,
      (token) => EXCEL_DATE_TOKENS[token] ?? token,
    );
  }
  if (spec.kind === "number") {
    const integer = spec.grouped ? "#,##0" : "0";
    const fraction = spec.decimals > 0 ? `.${"0".repeat(spec.decimals)}` : "";
    return `${excelLiteral(spec.prefix)}${integer}${fraction}${excelLiteral(spec.suffix)}`;
  }
  return undefined;
}

const EXCEL_DATE_TOKENS: Record<string, string> = {
  ГГГГ: "yyyy",
  ГГ: "yy",
  ММММ: "mmmm",
  МММ: "mmm",
  ММ: "mm",
  М: "m",
  ДД: "dd",
  Д: "d",
  чч: "hh",
  ч: "h",
  мм: "mm",
  м: "m",
  сс: "ss",
  с: "s",
};

/** Приписка вокруг числа: в кавычках, чтобы Excel не принял её за свои коды. */
function excelLiteral(text: string): string {
  if (!text) return "";
  if (text === "%") return text;
  return `"${text.replace(/"/g, "")}"`;
}
