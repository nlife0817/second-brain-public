// Библиотека функций и правила приведения типов.
//
// Семантика эксель-совместимая, потому что таблицы приезжают из Excel и Google
// Sheets: пустая ячейка в арифметике это ноль, а в сравнении с нулём — равна
// ему; текст в арифметике даёт #VALUE!, а в SUM просто пропускается; сравнение
// строк регистронезависимо. Эти правила выглядят произвольными, но именно на
// них рассчитаны формулы, которые человек к нам принесёт.
//
// Функции с недетерминированным результатом (RAND, RANDBETWEEN) не заведены
// намеренно: значение формулы кэшируется в ячейке и попадает в автосохранение,
// то есть книга менялась бы сама по себе, плодя версии на пустом месте.
// TODAY/NOW по той же причине считаются от даты открытия и в историю не пишутся
// сами — их значение обновится при следующей правке.

import { ERR, FormulaError, isError } from "./formula";

/** Скаляр в вычислениях. `null` — пустая ячейка (это не то же, что ноль). */
export type Scalar = number | string | boolean | FormulaError | null;
/** Значение диапазона: строки × колонки. */
export type Matrix = Scalar[][];
export type Value = Scalar | Matrix;

export function isMatrix(value: Value): value is Matrix {
  return Array.isArray(value);
}

/** Диапазон там, где ждали одно значение, сворачивается в левый верхний угол. */
export function toScalar(value: Value): Scalar {
  if (!isMatrix(value)) return value;
  return value[0]?.[0] ?? null;
}

// --- Приведение типов ------------------------------------------------------

/** Число из значения. Пусто — ноль, «12,5» и «12.5» — число, прочий текст — #VALUE!. */
export function toNumber(value: Value): number | FormulaError {
  const scalar = toScalar(value);
  if (isError(scalar)) return scalar;
  if (scalar === null || scalar === "") return 0;
  if (typeof scalar === "number") return scalar;
  if (typeof scalar === "boolean") return scalar ? 1 : 0;
  const text = scalar.trim().replace(/\s| /g, "");
  if (!text) return 0;
  // Запятая как десятичный разделитель — норма для данных из русского Excel.
  const normalized = text.includes(",") && !text.includes(".") ? text.replace(",", ".") : text;
  const percent = normalized.endsWith("%");
  const n = Number(percent ? normalized.slice(0, -1) : normalized);
  if (Number.isNaN(n)) return ERR.value;
  return percent ? n / 100 : n;
}

export function toText(value: Value): string | FormulaError {
  const scalar = toScalar(value);
  if (isError(scalar)) return scalar;
  if (scalar === null) return "";
  if (typeof scalar === "boolean") return scalar ? "ИСТИНА" : "ЛОЖЬ";
  if (typeof scalar === "number") return formatNumberForText(scalar);
  return scalar;
}

/** Число в текст без экспоненты и хвостов плавающей точки. */
export function formatNumberForText(n: number): string {
  if (!Number.isFinite(n)) return "#NUM!";
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const rounded = Number(n.toPrecision(15));
  return String(rounded);
}

export function toBoolean(value: Value): boolean | FormulaError {
  const scalar = toScalar(value);
  if (isError(scalar)) return scalar;
  if (scalar === null || scalar === "") return false;
  if (typeof scalar === "boolean") return scalar;
  if (typeof scalar === "number") return scalar !== 0;
  const text = scalar.trim().toUpperCase();
  if (text === "TRUE" || text === "ИСТИНА") return true;
  if (text === "FALSE" || text === "ЛОЖЬ") return false;
  return ERR.value;
}

/** Все скаляры аргументов подряд: диапазоны разворачиваются, порядок сохраняется. */
export function flatten(values: Value[]): Scalar[] {
  const out: Scalar[] = [];
  for (const value of values) {
    if (isMatrix(value)) {
      for (const row of value) for (const cell of row) out.push(cell);
    } else out.push(value);
  }
  return out;
}

/** Первая ошибка среди значений — её и надо вернуть наружу. */
export function firstError(values: Scalar[]): FormulaError | null {
  for (const value of values) if (isError(value)) return value;
  return null;
}

/**
 * Числа для агрегатов. Текст и пустые пропускаются (так считает SUM по
 * диапазону), но ошибка внутри диапазона обязана всплыть.
 */
export function numbersIn(values: Value[]): number[] | FormulaError {
  const out: number[] = [];
  for (const scalar of flatten(values)) {
    if (isError(scalar)) return scalar;
    if (scalar === null || scalar === "") continue;
    if (typeof scalar === "boolean") continue;
    if (typeof scalar === "number") {
      out.push(scalar);
      continue;
    }
    // Число, записанное текстом, в диапазоне не считается — как в Excel.
  }
  return out;
}

/** Числа из «плоских» аргументов (SUM(1;"2") — двойка считается). */
function numbersInArgs(values: Value[]): number[] | FormulaError {
  const out: number[] = [];
  for (const value of values) {
    if (isMatrix(value)) {
      const nested = numbersIn([value]);
      if (isError(nested)) return nested;
      out.push(...nested);
      continue;
    }
    if (value === null || value === "") continue;
    const n = toNumber(value);
    if (isError(n)) return n;
    out.push(n);
  }
  return out;
}

// --- Сравнение -------------------------------------------------------------

/**
 * Порядок значений как в Excel: числа < текст < ЛОЖЬ < ИСТИНА, текст
 * сравнивается без учёта регистра. Пустая ячейка приравнивается к нулю или к
 * пустой строке — смотря с чем сравнивают.
 */
export function compareValues(a: Scalar, b: Scalar): number {
  const left = a === null ? (typeof b === "string" ? "" : 0) : a;
  const right = b === null ? (typeof a === "string" ? "" : 0) : b;
  const rank = (v: Scalar) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);
  const ra = rank(left);
  const rb = rank(right);
  if (ra !== rb) return ra - rb;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") {
    return left.toLowerCase().localeCompare(right.toLowerCase(), "ru");
  }
  return Number(left) - Number(right);
}

// --- Условия COUNTIF / SUMIF ----------------------------------------------

type Criterion = (value: Scalar) => boolean;

/**
 * Условие вида «>5», «<>» , «яблоко», «ябл*». Разбирается один раз на вызов —
 * иначе на каждой ячейке диапазона повторялся бы разбор строки.
 */
export function buildCriterion(raw: Value): Criterion {
  const scalar = toScalar(raw);
  if (isError(scalar)) return () => false;
  if (typeof scalar === "number" || typeof scalar === "boolean") {
    return (value) => compareValues(value, scalar) === 0;
  }
  const text = (scalar ?? "").toString().trim();
  const m = /^(<=|>=|<>|=|<|>)?(.*)$/.exec(text);
  const op = m?.[1] ?? "";
  const operand = (m?.[2] ?? "").trim();
  const asNumber = operand === "" ? null : Number(operand.replace(",", "."));
  const target: Scalar =
    asNumber !== null && !Number.isNaN(asNumber) && operand !== "" ? asNumber : operand;

  if (!op || op === "=") {
    if (typeof target === "string" && /[*?]/.test(target)) {
      const re = wildcardRegExp(target);
      return (value) => re.test(String(toText(value)));
    }
    return (value) => compareValues(value, target) === 0;
  }
  if (op === "<>") {
    if (typeof target === "string" && /[*?]/.test(target)) {
      const re = wildcardRegExp(target);
      return (value) => !re.test(String(toText(value)));
    }
    return (value) => compareValues(value, target) !== 0;
  }
  return (value) => {
    // Пустую ячейку в сравнениях «>» Excel не учитывает.
    if (value === null || value === "") return false;
    const cmp = compareValues(value, target);
    if (op === "<") return cmp < 0;
    if (op === "<=") return cmp <= 0;
    if (op === ">") return cmp > 0;
    return cmp >= 0;
  };
}

function wildcardRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
}

// --- Даты ------------------------------------------------------------------
//
// Даты хранятся эксель-серийным числом: дней с 30 декабря 1899 года. Так их
// понимают и формулы (разность дат — число дней), и выгрузка в xlsx, и импорт.

const EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

export function dateToSerial(date: Date): number {
  return (date.getTime() - EPOCH) / DAY_MS;
}

export function serialToDate(serial: number): Date {
  return new Date(EPOCH + Math.round(serial * DAY_MS));
}

/** Полдень «сегодня» в серийном виде — дробная часть отброшена. */
function todaySerial(now: Date): number {
  return Math.floor(dateToSerial(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))));
}

// --- Реестр функций --------------------------------------------------------

export interface CallContext {
  /** Момент вычисления — общий на всю книгу, чтобы TODAY совпал во всех ячейках. */
  now: Date;
  /** Позиция считаемой ячейки: нужна ROW() и COLUMN() без аргументов. */
  row: number;
  col: number;
}

export type SheetFunction = (args: Value[], ctx: CallContext) => Value;

const num = (value: Value): number | FormulaError => toNumber(value);

/** Обёртка для функций одного числового аргумента. */
function math1(fn: (x: number) => number): SheetFunction {
  return (args) => {
    const x = num(args[0] ?? 0);
    if (isError(x)) return x;
    const result = fn(x);
    return Number.isFinite(result) ? result : ERR.num;
  };
}

function requireArgs(args: Value[], count: number): FormulaError | null {
  return args.length < count ? ERR.value : null;
}

export const FUNCTIONS: Record<string, SheetFunction> = {
  // --- Математика ---
  SUM: (args) => {
    const numbers = numbersInArgs(args);
    return isError(numbers) ? numbers : numbers.reduce((a, b) => a + b, 0);
  },
  PRODUCT: (args) => {
    const numbers = numbersInArgs(args);
    if (isError(numbers)) return numbers;
    return numbers.length ? numbers.reduce((a, b) => a * b, 1) : 0;
  },
  ABS: math1(Math.abs),
  SIGN: math1(Math.sign),
  SQRT: (args) => {
    const x = num(args[0] ?? 0);
    if (isError(x)) return x;
    return x < 0 ? ERR.num : Math.sqrt(x);
  },
  EXP: math1(Math.exp),
  LN: (args) => {
    const x = num(args[0] ?? 0);
    if (isError(x)) return x;
    return x > 0 ? Math.log(x) : ERR.num;
  },
  LOG10: (args) => {
    const x = num(args[0] ?? 0);
    if (isError(x)) return x;
    return x > 0 ? Math.log10(x) : ERR.num;
  },
  LOG: (args) => {
    const x = num(args[0] ?? 0);
    const base = num(args[1] ?? 10);
    if (isError(x)) return x;
    if (isError(base)) return base;
    if (x <= 0 || base <= 0 || base === 1) return ERR.num;
    return Math.log(x) / Math.log(base);
  },
  POWER: (args) => {
    const x = num(args[0] ?? 0);
    const y = num(args[1] ?? 0);
    if (isError(x)) return x;
    if (isError(y)) return y;
    const result = x ** y;
    return Number.isFinite(result) ? result : ERR.num;
  },
  MOD: (args) => {
    const x = num(args[0] ?? 0);
    const y = num(args[1] ?? 0);
    if (isError(x)) return x;
    if (isError(y)) return y;
    if (y === 0) return ERR.div0;
    // Знак результата в Excel следует за делителем, а не за делимым.
    return x - y * Math.floor(x / y);
  },
  INT: math1(Math.floor),
  TRUNC: (args) => {
    const x = num(args[0] ?? 0);
    const digits = num(args[1] ?? 0);
    if (isError(x)) return x;
    if (isError(digits)) return digits;
    const factor = 10 ** Math.trunc(digits);
    return Math.trunc(x * factor) / factor;
  },
  ROUND: (args) => roundTo(args, "half"),
  ROUNDUP: (args) => roundTo(args, "up"),
  ROUNDDOWN: (args) => roundTo(args, "down"),
  CEILING: (args) => {
    const x = num(args[0] ?? 0);
    const step = num(args[1] ?? 1);
    if (isError(x)) return x;
    if (isError(step)) return step;
    if (step === 0) return 0;
    return Math.ceil(x / step) * step;
  },
  FLOOR: (args) => {
    const x = num(args[0] ?? 0);
    const step = num(args[1] ?? 1);
    if (isError(x)) return x;
    if (isError(step)) return step;
    if (step === 0) return ERR.div0;
    return Math.floor(x / step) * step;
  },
  SUMIF: (args) => {
    const missing = requireArgs(args, 2);
    if (missing) return missing;
    const range = asMatrix(args[0]);
    const test = buildCriterion(args[1]);
    const target = args[2] === undefined ? range : asMatrix(args[2]);
    let sum = 0;
    forEachPair(range, target, (value, mapped) => {
      if (!test(value)) return;
      if (typeof mapped === "number") sum += mapped;
    });
    return sum;
  },
  SUMIFS: (args) => {
    const missing = requireArgs(args, 3);
    if (missing) return missing;
    const target = asMatrix(args[0]);
    const conditions = pairConditions(args.slice(1));
    if (isError(conditions)) return conditions;
    let sum = 0;
    forEachMatching(target, conditions, (value) => {
      if (typeof value === "number") sum += value;
    });
    return sum;
  },
  COUNT: (args) => {
    const numbers = numbersIn(args);
    return isError(numbers) ? numbers : numbers.length;
  },
  COUNTA: (args) => flatten(args).filter((v) => v !== null && v !== "").length,
  COUNTBLANK: (args) => flatten(args).filter((v) => v === null || v === "").length,
  COUNTIF: (args) => {
    const missing = requireArgs(args, 2);
    if (missing) return missing;
    const test = buildCriterion(args[1]);
    return flatten([args[0]]).filter((value) => test(value)).length;
  },
  COUNTIFS: (args) => {
    const missing = requireArgs(args, 2);
    if (missing) return missing;
    const conditions = pairConditions(args);
    if (isError(conditions)) return conditions;
    let count = 0;
    forEachMatching(conditions[0].range, conditions, () => {
      count++;
    });
    return count;
  },
  AVERAGE: (args) => {
    const numbers = numbersInArgs(args);
    if (isError(numbers)) return numbers;
    return numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : ERR.div0;
  },
  AVERAGEIF: (args) => {
    const missing = requireArgs(args, 2);
    if (missing) return missing;
    const range = asMatrix(args[0]);
    const test = buildCriterion(args[1]);
    const target = args[2] === undefined ? range : asMatrix(args[2]);
    let sum = 0;
    let count = 0;
    forEachPair(range, target, (value, mapped) => {
      if (!test(value)) return;
      if (typeof mapped === "number") {
        sum += mapped;
        count++;
      }
    });
    return count ? sum / count : ERR.div0;
  },
  MAX: (args) => {
    const numbers = numbersInArgs(args);
    if (isError(numbers)) return numbers;
    return numbers.length ? Math.max(...numbers) : 0;
  },
  MIN: (args) => {
    const numbers = numbersInArgs(args);
    if (isError(numbers)) return numbers;
    return numbers.length ? Math.min(...numbers) : 0;
  },
  MEDIAN: (args) => {
    const numbers = numbersInArgs(args);
    if (isError(numbers)) return numbers;
    if (!numbers.length) return ERR.num;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  },
  STDEV: (args) => spread(args, true),
  STDEVP: (args) => spread(args, false),
  VAR: (args) => variance(args, true),
  VARP: (args) => variance(args, false),
  LARGE: (args) => nth(args, "desc"),
  SMALL: (args) => nth(args, "asc"),
  RANK: (args) => {
    const missing = requireArgs(args, 2);
    if (missing) return missing;
    const value = num(args[0]);
    if (isError(value)) return value;
    const numbers = numbersIn([args[1]]);
    if (isError(numbers)) return numbers;
    const ascending = args[2] !== undefined && toNumber(args[2]) !== 0;
    const sorted = [...numbers].sort((a, b) => (ascending ? a - b : b - a));
    const index = sorted.indexOf(value);
    return index < 0 ? ERR.na : index + 1;
  },

  // --- Логика ---
  IF: (args) => {
    const missing = requireArgs(args, 2);
    if (missing) return missing;
    const test = toBoolean(args[0]);
    if (isError(test)) return test;
    return test ? args[1] : (args[2] ?? false);
  },
  IFS: (args) => {
    for (let i = 0; i + 1 < args.length; i += 2) {
      const test = toBoolean(args[i]);
      if (isError(test)) return test;
      if (test) return args[i + 1];
    }
    return ERR.na;
  },
  SWITCH: (args) => {
    const missing = requireArgs(args, 3);
    if (missing) return missing;
    const subject = toScalar(args[0]);
    for (let i = 1; i + 1 < args.length; i += 2) {
      if (compareValues(subject, toScalar(args[i])) === 0) return args[i + 1];
    }
    // Нечётный хвост — значение по умолчанию.
    return args.length % 2 === 0 ? args[args.length - 1] : ERR.na;
  },
  AND: (args) => {
    for (const value of flatten(args)) {
      if (value === null) continue;
      const test = toBoolean(value);
      if (isError(test)) return test;
      if (!test) return false;
    }
    return true;
  },
  OR: (args) => {
    for (const value of flatten(args)) {
      if (value === null) continue;
      const test = toBoolean(value);
      if (isError(test)) return test;
      if (test) return true;
    }
    return false;
  },
  XOR: (args) => {
    let count = 0;
    for (const value of flatten(args)) {
      if (value === null) continue;
      const test = toBoolean(value);
      if (isError(test)) return test;
      if (test) count++;
    }
    return count % 2 === 1;
  },
  NOT: (args) => {
    const test = toBoolean(args[0] ?? false);
    return isError(test) ? test : !test;
  },
  TRUE: () => true,
  FALSE: () => false,
  IFERROR: (args) => (isError(toScalar(args[0] ?? null)) ? (args[1] ?? "") : args[0]),
  IFNA: (args) => {
    const scalar = toScalar(args[0] ?? null);
    return isError(scalar) && scalar.code === "#N/A" ? (args[1] ?? "") : args[0];
  },
  ISERROR: (args) => isError(toScalar(args[0] ?? null)),
  ISBLANK: (args) => toScalar(args[0] ?? null) === null,
  ISNUMBER: (args) => typeof toScalar(args[0] ?? null) === "number",
  ISTEXT: (args) => typeof toScalar(args[0] ?? null) === "string",
  NA: () => ERR.na,

  // --- Текст ---
  CONCAT: (args) => joinText(flatten(args), ""),
  CONCATENATE: (args) => joinText(flatten(args), ""),
  TEXTJOIN: (args) => {
    const missing = requireArgs(args, 3);
    if (missing) return missing;
    const separator = toText(args[0]);
    if (isError(separator)) return separator;
    const skipEmpty = toBoolean(args[1]);
    if (isError(skipEmpty)) return skipEmpty;
    const parts = flatten(args.slice(2)).filter((v) => !skipEmpty || (v !== null && v !== ""));
    return joinText(parts, separator);
  },
  LEN: (args) => {
    const text = toText(args[0] ?? "");
    return isError(text) ? text : text.length;
  },
  LEFT: (args) => sliceText(args, "left"),
  RIGHT: (args) => sliceText(args, "right"),
  MID: (args) => {
    const text = toText(args[0] ?? "");
    if (isError(text)) return text;
    const start = num(args[1] ?? 1);
    const count = num(args[2] ?? 0);
    if (isError(start)) return start;
    if (isError(count)) return count;
    if (start < 1 || count < 0) return ERR.value;
    return text.slice(start - 1, start - 1 + Math.floor(count));
  },
  UPPER: (args) => mapText(args, (t) => t.toUpperCase()),
  LOWER: (args) => mapText(args, (t) => t.toLowerCase()),
  PROPER: (args) =>
    mapText(args, (t) => t.replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())),
  TRIM: (args) => mapText(args, (t) => t.trim().replace(/\s+/g, " ")),
  REPT: (args) => {
    const text = toText(args[0] ?? "");
    if (isError(text)) return text;
    const count = num(args[1] ?? 0);
    if (isError(count)) return count;
    const times = Math.floor(count);
    if (times < 0 || times * text.length > 32_000) return ERR.value;
    return text.repeat(times);
  },
  SUBSTITUTE: (args) => {
    const text = toText(args[0] ?? "");
    const from = toText(args[1] ?? "");
    const to = toText(args[2] ?? "");
    if (isError(text)) return text;
    if (isError(from)) return from;
    if (isError(to)) return to;
    if (from === "") return text;
    if (args[3] === undefined) return text.split(from).join(to);
    const occurrence = num(args[3]);
    if (isError(occurrence)) return occurrence;
    let index = -1;
    for (let i = 0; i < Math.floor(occurrence); i++) {
      index = text.indexOf(from, index + 1);
      if (index < 0) return text;
    }
    return text.slice(0, index) + to + text.slice(index + from.length);
  },
  REPLACE: (args) => {
    const text = toText(args[0] ?? "");
    const start = num(args[1] ?? 1);
    const count = num(args[2] ?? 0);
    const insert = toText(args[3] ?? "");
    if (isError(text)) return text;
    if (isError(start)) return start;
    if (isError(count)) return count;
    if (isError(insert)) return insert;
    const from = Math.floor(start) - 1;
    if (from < 0) return ERR.value;
    return text.slice(0, from) + insert + text.slice(from + Math.floor(count));
  },
  FIND: (args) => findText(args, true),
  SEARCH: (args) => findText(args, false),
  EXACT: (args) => {
    const a = toText(args[0] ?? "");
    const b = toText(args[1] ?? "");
    if (isError(a)) return a;
    if (isError(b)) return b;
    return a === b;
  },
  VALUE: (args) => {
    const n = num(args[0] ?? 0);
    return n;
  },
  TEXT: (args) => {
    // Полноценный разбор формата живёт в format.ts; здесь достаточно того,
    // что человек чаще всего пишет: число знаков и разделители.
    const value = toNumber(args[0] ?? 0);
    if (isError(value)) return value;
    const pattern = toText(args[1] ?? "");
    if (isError(pattern)) return pattern;
    const decimals = (/\.(0+)/.exec(pattern)?.[1] ?? "").length;
    const grouped = pattern.includes("# ##") || pattern.includes("#,##");
    const fixed = value.toFixed(decimals);
    if (!grouped) return fixed;
    const [whole, fraction] = fixed.split(".");
    const spaced = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return fraction ? `${spaced},${fraction}` : spaced;
  },

  // --- Поиск ---
  VLOOKUP: (args) => lookup(args, "v"),
  HLOOKUP: (args) => lookup(args, "h"),
  MATCH: (args) => {
    const missing = requireArgs(args, 2);
    if (missing) return missing;
    const needle = toScalar(args[0]);
    const haystack = flatten([args[1]]);
    const mode = args[2] === undefined ? 1 : toNumber(args[2]);
    if (isError(mode)) return mode;
    if (mode === 0) {
      const index = haystack.findIndex((value) => compareValues(value, needle) === 0);
      return index < 0 ? ERR.na : index + 1;
    }
    // Приблизительный поиск: последнее значение, не превосходящее искомого.
    let found = -1;
    for (let i = 0; i < haystack.length; i++) {
      const cmp = compareValues(haystack[i], needle);
      if (mode > 0 ? cmp <= 0 : cmp >= 0) found = i;
      else break;
    }
    return found < 0 ? ERR.na : found + 1;
  },
  INDEX: (args) => {
    const missing = requireArgs(args, 2);
    if (missing) return missing;
    const matrix = asMatrix(args[0]);
    const row = toNumber(args[1] ?? 0);
    if (isError(row)) return row;
    const col = args[2] === undefined ? 1 : toNumber(args[2]);
    if (isError(col)) return col;
    // Одномерный диапазон допускает INDEX(range; n) — n тогда номер элемента.
    if (matrix.length === 1 && args[2] === undefined) return matrix[0][row - 1] ?? ERR.ref;
    if (matrix[0]?.length === 1 && args[2] === undefined) return matrix[row - 1]?.[0] ?? ERR.ref;
    const cell = matrix[row - 1]?.[col - 1];
    return cell === undefined ? ERR.ref : cell;
  },
  XLOOKUP: (args) => {
    const missing = requireArgs(args, 3);
    if (missing) return missing;
    const needle = toScalar(args[0]);
    const haystack = flatten([args[1]]);
    const results = flatten([args[2]]);
    const index = haystack.findIndex((value) => compareValues(value, needle) === 0);
    if (index < 0) return args[3] ?? ERR.na;
    return results[index] ?? ERR.na;
  },
  CHOOSE: (args) => {
    const index = toNumber(args[0] ?? 0);
    if (isError(index)) return index;
    const picked = args[Math.floor(index)];
    return picked === undefined ? ERR.value : picked;
  },
  ROW: (args, ctx) => {
    if (args.length === 0) return ctx.row + 1;
    return ERR.value;
  },
  COLUMN: (args, ctx) => {
    if (args.length === 0) return ctx.col + 1;
    return ERR.value;
  },
  ROWS: (args) => asMatrix(args[0] ?? null).length,
  COLUMNS: (args) => asMatrix(args[0] ?? null)[0]?.length ?? 0,

  // --- Даты ---
  TODAY: (_args, ctx) => todaySerial(ctx.now),
  NOW: (_args, ctx) => dateToSerial(ctx.now),
  DATE: (args) => {
    const y = toNumber(args[0] ?? 0);
    const m = toNumber(args[1] ?? 1);
    const d = toNumber(args[2] ?? 1);
    if (isError(y)) return y;
    if (isError(m)) return m;
    if (isError(d)) return d;
    return dateToSerial(new Date(Date.UTC(y, m - 1, d)));
  },
  YEAR: (args) => datePart(args, (date) => date.getUTCFullYear()),
  MONTH: (args) => datePart(args, (date) => date.getUTCMonth() + 1),
  DAY: (args) => datePart(args, (date) => date.getUTCDate()),
  HOUR: (args) => datePart(args, (date) => date.getUTCHours()),
  MINUTE: (args) => datePart(args, (date) => date.getUTCMinutes()),
  SECOND: (args) => datePart(args, (date) => date.getUTCSeconds()),
  /** Понедельник = 1: у нас неделя начинается с него, а не с воскресенья. */
  WEEKDAY: (args) => datePart(args, (date) => ((date.getUTCDay() + 6) % 7) + 1),
  DAYS: (args) => {
    const end = toNumber(args[0] ?? 0);
    const start = toNumber(args[1] ?? 0);
    if (isError(end)) return end;
    if (isError(start)) return start;
    return Math.round(end - start);
  },
  EDATE: (args) => shiftMonths(args, 0),
  EOMONTH: (args) => shiftMonths(args, 1),
};

// --- Вспомогательное для реестра -------------------------------------------

function joinText(values: Scalar[], separator: string): string | FormulaError {
  const parts: string[] = [];
  for (const value of values) {
    const text = toText(value);
    if (isError(text)) return text;
    parts.push(text);
  }
  return parts.join(separator);
}

function mapText(args: Value[], fn: (text: string) => string): Value {
  const text = toText(args[0] ?? "");
  return isError(text) ? text : fn(text);
}

function sliceText(args: Value[], side: "left" | "right"): Value {
  const text = toText(args[0] ?? "");
  if (isError(text)) return text;
  const count = args[1] === undefined ? 1 : toNumber(args[1]);
  if (isError(count)) return count;
  const n = Math.floor(count);
  if (n < 0) return ERR.value;
  return side === "left" ? text.slice(0, n) : n === 0 ? "" : text.slice(-n);
}

function findText(args: Value[], caseSensitive: boolean): Value {
  const needle = toText(args[0] ?? "");
  const haystack = toText(args[1] ?? "");
  if (isError(needle)) return needle;
  if (isError(haystack)) return haystack;
  const start = args[2] === undefined ? 1 : toNumber(args[2]);
  if (isError(start)) return start;
  const from = Math.floor(start) - 1;
  if (from < 0) return ERR.value;
  const index = caseSensitive
    ? haystack.indexOf(needle, from)
    : haystack.toLowerCase().indexOf(needle.toLowerCase(), from);
  return index < 0 ? ERR.value : index + 1;
}

/**
 * Сдвиг десятичной точки через строку, а не умножением на 10^n.
 *
 * `1.005 * 100` в двоичной арифметике равно 100.49999999999999, и обычное
 * округление до двух знаков дало бы 1,00 там, где человек и Excel видят 1,01.
 * Строковая запись числа в JS — кратчайшая, которая читается обратно в него же,
 * то есть «1.005»; сдвиг показателя в ней ошибку не вносит.
 */
export function shiftDecimal(value: number, digits: number): number {
  if (!Number.isFinite(value) || digits === 0) return value;
  const [mantissa, exponent] = String(value).split("e");
  const shifted = `${mantissa}e${exponent ? Number(exponent) + digits : digits}`;
  const result = Number(shifted);
  return Number.isFinite(result) ? result : value;
}

function roundTo(args: Value[], mode: "half" | "up" | "down"): Value {
  const x = toNumber(args[0] ?? 0);
  if (isError(x)) return x;
  const digits = args[1] === undefined ? 0 : toNumber(args[1]);
  if (isError(digits)) return digits;
  const d = Math.trunc(digits);
  const scaled = shiftDecimal(Math.abs(x), d);
  // Половина округляется от нуля — как в Excel, а не «к чётному», как в JS.
  const rounded =
    mode === "half" ? Math.round(scaled) : mode === "up" ? Math.ceil(scaled) : Math.floor(scaled);
  return Math.sign(x) * shiftDecimal(rounded, -d);
}

function spread(args: Value[], sample: boolean): Value {
  const result = variance(args, sample);
  return isError(result) ? result : Math.sqrt(result as number);
}

function variance(args: Value[], sample: boolean): Value {
  const numbers = numbersInArgs(args);
  if (isError(numbers)) return numbers;
  const n = numbers.length;
  if (n < (sample ? 2 : 1)) return ERR.div0;
  const mean = numbers.reduce((a, b) => a + b, 0) / n;
  const sum = numbers.reduce((acc, value) => acc + (value - mean) ** 2, 0);
  return sum / (sample ? n - 1 : n);
}

function nth(args: Value[], order: "asc" | "desc"): Value {
  const numbers = numbersIn([args[0] ?? null]);
  if (isError(numbers)) return numbers;
  const k = toNumber(args[1] ?? 0);
  if (isError(k)) return k;
  const index = Math.floor(k);
  if (index < 1 || index > numbers.length) return ERR.num;
  const sorted = [...numbers].sort((a, b) => (order === "asc" ? a - b : b - a));
  return sorted[index - 1];
}

function datePart(args: Value[], fn: (date: Date) => number): Value {
  const serial = toNumber(args[0] ?? 0);
  if (isError(serial)) return serial;
  return fn(serialToDate(serial));
}

function shiftMonths(args: Value[], endOfMonth: 0 | 1): Value {
  const serial = toNumber(args[0] ?? 0);
  const months = toNumber(args[1] ?? 0);
  if (isError(serial)) return serial;
  if (isError(months)) return months;
  const date = serialToDate(serial);
  const shifted = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + Math.trunc(months) + endOfMonth,
      endOfMonth ? 0 : date.getUTCDate(),
    ),
  );
  return dateToSerial(shifted);
}

/** Любое значение как прямоугольник: скаляр становится матрицей 1×1. */
export function asMatrix(value: Value): Matrix {
  if (isMatrix(value)) return value;
  return [[value]];
}

/** Обход двух одинаково устроенных диапазонов: условие и то, что суммируем. */
function forEachPair(range: Matrix, target: Matrix, fn: (value: Scalar, mapped: Scalar) => void) {
  for (let r = 0; r < range.length; r++) {
    for (let c = 0; c < (range[r]?.length ?? 0); c++) {
      fn(range[r][c], target[r]?.[c] ?? null);
    }
  }
}

interface Condition {
  range: Matrix;
  test: (value: Scalar) => boolean;
}

/** Пары «диапазон; условие» из хвоста аргументов COUNTIFS/SUMIFS. */
function pairConditions(args: Value[]): Condition[] | FormulaError {
  if (args.length % 2 !== 0) return ERR.value;
  const out: Condition[] = [];
  for (let i = 0; i + 1 < args.length; i += 2) {
    out.push({ range: asMatrix(args[i]), test: buildCriterion(args[i + 1]) });
  }
  return out.length ? out : ERR.value;
}

/** Позиции, прошедшие все условия; значение берётся из целевого диапазона. */
function forEachMatching(target: Matrix, conditions: Condition[], fn: (value: Scalar) => void) {
  const rows = conditions[0].range.length;
  for (let r = 0; r < rows; r++) {
    const cols = conditions[0].range[r]?.length ?? 0;
    for (let c = 0; c < cols; c++) {
      const ok = conditions.every((condition) => condition.test(condition.range[r]?.[c] ?? null));
      if (ok) fn(target[r]?.[c] ?? null);
    }
  }
}

function lookup(args: Value[], direction: "v" | "h"): Value {
  const missing = requireArgs(args, 3);
  if (missing) return missing;
  const needle = toScalar(args[0]);
  const table = asMatrix(args[1]);
  const index = toNumber(args[2]);
  if (isError(index)) return index;
  const line = Math.floor(index);
  if (line < 1) return ERR.value;
  // Четвёртый аргумент — приблизительный поиск. По умолчанию в Excel он ИСТИНА,
  // но на практике почти всегда имеют в виду точное совпадение, а неточное на
  // неотсортированных данных молча врёт. Поэтому умолчание здесь — точный поиск.
  const approximate = args[3] === undefined ? false : toBoolean(args[3]);
  if (isError(approximate)) return approximate;

  const keys = direction === "v" ? table.map((row) => row[0] ?? null) : (table[0] ?? []);
  let found = -1;
  if (approximate) {
    for (let i = 0; i < keys.length; i++) {
      if (compareValues(keys[i], needle) <= 0) found = i;
      else break;
    }
  } else {
    found = keys.findIndex((key) => compareValues(key, needle) === 0);
  }
  if (found < 0) return ERR.na;

  const cell = direction === "v" ? table[found]?.[line - 1] : table[line - 1]?.[found];
  return cell === undefined ? ERR.ref : cell;
}
