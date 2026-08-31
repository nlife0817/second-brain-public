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
  return fmt === FORMATS.date || fmt === FORMATS.dateTime || fmt === FORMATS.time;
}

// --- Показ -----------------------------------------------------------------

/** Значение ячейки → то, что видно в клетке. */
export function formatValue(value: CellValue, fmt?: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "ИСТИНА" : "ЛОЖЬ";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "#NUM!";

  switch (fmt) {
    case FORMATS.text:
      return generalNumber(value);
    case FORMATS.integer:
      return fixed(value, 0, false);
    case FORMATS.decimal:
      return fixed(value, 2, false);
    case FORMATS.thousands:
      return fixed(value, 0, true);
    case FORMATS.thousandsDecimal:
      return fixed(value, 2, true);
    case FORMATS.percent:
      return `${fixed(value * 100, 0, false)}%`;
    case FORMATS.percentDecimal:
      return `${fixed(value * 100, 2, false)}%`;
    case FORMATS.rub:
      return `${fixed(value, 2, true)} ₽`;
    case FORMATS.usd:
      return `$${fixed(value, 2, true)}`;
    case FORMATS.eur:
      return `€${fixed(value, 2, true)}`;
    case FORMATS.date:
      return formatDate(value, false, false);
    case FORMATS.dateTime:
      return formatDate(value, true, false);
    case FORMATS.time:
      return formatDate(value, true, true);
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

function formatDate(serial: number, withTime: boolean, timeOnly: boolean): string {
  const date = serialToDate(serial);
  if (Number.isNaN(date.getTime())) return "#NUM!";
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  if (timeOnly) return `${hh}:${mi}`;
  return withTime ? `${dd}.${mm}.${yyyy} ${hh}:${mi}` : `${dd}.${mm}.${yyyy}`;
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
  if (fmt.includes("%")) return fmt.includes(".00") ? FORMATS.percentDecimal : FORMATS.percent;
  if (/[dmyдмг]/.test(fmt) && /[/.\-]/.test(fmt)) {
    return /[hчs]/.test(fmt) ? FORMATS.dateTime : FORMATS.date;
  }
  if (/^\[?\$?h+.*m+/.test(fmt) || (/[hч]/.test(fmt) && /:/.test(fmt) && !/[dyдг]/.test(fmt))) {
    return FORMATS.time;
  }
  if (fmt.includes("₽") || fmt.includes("руб")) return FORMATS.rub;
  if (fmt.includes("$")) return FORMATS.usd;
  if (fmt.includes("€")) return FORMATS.eur;
  const grouped = fmt.includes("#,##") || fmt.includes("# ##");
  const decimals = /\.0+/.test(fmt);
  if (grouped) return decimals ? FORMATS.thousandsDecimal : FORMATS.thousands;
  if (decimals) return FORMATS.decimal;
  if (/^0+$/.test(fmt)) return FORMATS.integer;
  return undefined;
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
      return undefined;
  }
}
