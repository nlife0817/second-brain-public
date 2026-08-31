// Протягивание за уголок: продолжение ряда и размножение формул.
//
// Жест один, а ожиданий за ним три разных, и все три считаются само собой
// разумеющимися: формула обязана поехать со сдвигом ссылок, «1, 2» — стать
// «3, 4, 5», а «Задача 1» — «Задачей 2». Правило выбирается по образцу, а не
// спрашивается у человека, поэтому оно должно совпадать с тем, к чему приучили
// Excel и Google Sheets:
//
//  · одно число копируется, два и больше с одинаковым шагом продолжаются
//    (иначе размножить цену «1000» по колонке было бы нечем);
//  · одна дата продолжается по дню — так делают обе таблицы, и это тот случай,
//    когда копирование почти никогда не нужно;
//  · текст с числом на конце продолжается уже с одной ячейки;
//  · день недели и месяц идут по своему списку;
//  · всё остальное повторяется по кругу.
//
// Ряды считаются здесь, отдельно от жеста, ровно потому, что «11, 12» должно
// продолжиться «13», а не «11, 12, 11, 12» — и проверить это надо тестом, а не
// мышью.

import { isDateFormat } from "./format";
import { offsetFormula } from "./formula";
import { dateToSerial, serialToDate } from "./functions";
import {
  getCell,
  setCell,
  SHEET_LIMITS,
  type CellRange,
  type CellValue,
  type SheetCell,
  type Workbook,
} from "./model";
import { cloneWorkbook, styleOf } from "./ops";

/** Ячейка образца в том виде, в каком её видит определитель ряда. */
export interface FillSample {
  value: CellValue;
  /** Код формата: он отличает дату от числа в сорок пять тысяч. */
  fmt?: string;
  /** У формулы своё продолжение — сдвиг ссылок, а не ряд значений. */
  formula: boolean;
}

/**
 * Списки, которые продолжаются по кругу. Порядок важен: значение ищется в
 * первом подходящем, поэтому полные названия стоят раньше сокращений, а
 * родительный падеж («мая») — после именительного, иначе «май» в списке дат
 * увёл бы ряд не туда.
 */
const SEQUENCES: string[][] = [
  ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"],
  ["пн", "вт", "ср", "чт", "пт", "сб", "вс"],
  [
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
  ],
  [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ],
  ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ],
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
  ["I", "II", "III", "IV"],
];

/** Сколько ячеек можно записать за одно протягивание. */
const FILL_LIMIT = SHEET_LIMITS.cells;

/**
 * Продолжить ряд по образцу.
 *
 * `pattern` идёт в порядке протягивания: при движении вверх вызывающий
 * переворачивает образец, и «вверх» становится обычным «дальше» с
 * отрицательным шагом.
 */
export function continueSeries(pattern: FillSample[], count: number): CellValue[] {
  if (!pattern.length || count <= 0) return [];

  const cycle = () => {
    const out: CellValue[] = [];
    for (let i = 0; i < count; i++) out.push(pattern[i % pattern.length].value ?? null);
    return out;
  };

  // У формулы своё продолжение — её значения всё равно перепишет пересчёт.
  if (pattern.some((sample) => sample.formula)) return cycle();

  const numbers = pattern.every((sample) => typeof sample.value === "number")
    ? pattern.map((sample) => sample.value as number)
    : null;

  if (numbers) {
    const dates = pattern.every((sample) => isDateFormat(sample.fmt));
    if (dates) {
      const months = monthStep(numbers);
      if (months !== null) return shiftMonths(numbers[numbers.length - 1], months, count);
      const step = arithmeticStep(numbers) ?? (numbers.length === 1 ? 1 : null);
      if (step !== null) return arithmetic(numbers[numbers.length - 1], step, count);
      return cycle();
    }
    const step = arithmeticStep(numbers);
    if (step === null) return cycle();
    return arithmetic(numbers[numbers.length - 1], step, count);
  }

  const texts = pattern.every((sample) => typeof sample.value === "string")
    ? pattern.map((sample) => sample.value as string)
    : null;

  if (texts) {
    const list = sequenceSeries(texts, count);
    if (list) return list;
    const numbered = numberedSeries(texts, count);
    if (numbered) return numbered;
  }

  return cycle();
}

/** Постоянный шаг ряда. `null` — шага нет: ряд не арифметический. */
function arithmeticStep(values: number[]): number | null {
  if (values.length < 2) return null;
  const step = values[1] - values[0];
  for (let i = 2; i < values.length; i++) {
    // Сравнение с допуском: 0,1 + 0,2 в двоичной арифметике не 0,3.
    if (Math.abs(values[i] - values[i - 1] - step) > 1e-9) return null;
  }
  return step;
}

function arithmetic(last: number, step: number, count: number): CellValue[] {
  const out: CellValue[] = [];
  for (let i = 1; i <= count; i++) {
    const value = last + step * i;
    // Хвосты двоичной арифметики: 0,1 + 0,2 + 0,3 не должно давать 0,6000000000000001.
    out.push(Number(value.toPrecision(12)));
  }
  return out;
}

/**
 * Шаг ряда дат в месяцах: «01.01, 01.02» — это помесячный отчёт, а не 31 день.
 * Требуем одинакового числа месяца: у «31.01, 28.02» ряда по месяцам нет.
 */
function monthStep(serials: number[]): number | null {
  if (serials.length < 2) return null;
  const dates = serials.map(serialToDate);
  if (dates.some((date) => Number.isNaN(date.getTime()))) return null;
  const day = dates[0].getUTCDate();
  if (!dates.every((date) => date.getUTCDate() === day)) return null;

  const months = dates.map((date) => date.getUTCFullYear() * 12 + date.getUTCMonth());
  const step = months[1] - months[0];
  if (step === 0) return null;
  for (let i = 2; i < months.length; i++) {
    if (months[i] - months[i - 1] !== step) return null;
  }
  return step;
}

function shiftMonths(last: number, step: number, count: number): CellValue[] {
  const base = serialToDate(last);
  const time = last - Math.floor(last);
  const out: CellValue[] = [];
  for (let i = 1; i <= count; i++) {
    const target = base.getUTCFullYear() * 12 + base.getUTCMonth() + step * i;
    const year = Math.floor(target / 12);
    const month = ((target % 12) + 12) % 12;
    // 31 января плюс месяц — это 28 (или 29) февраля, а не 3 марта.
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(base.getUTCDate(), days);
    out.push(dateToSerial(new Date(Date.UTC(year, month, day))) + time);
  }
  return out;
}

/** Ряд по списку: дни недели и месяцы. `null` — образец не из списка. */
function sequenceSeries(texts: string[], count: number): CellValue[] | null {
  const lower = texts.map((text) => text.trim().toLowerCase());
  const list = SEQUENCES.find((items) => lower.every((text) => items.includes(text)));
  if (!list) return null;

  const indices = lower.map((text) => list.indexOf(text));
  let step = 1;
  if (indices.length > 1) {
    const size = list.length;
    step = (((indices[1] - indices[0]) % size) + size) % size;
    for (let i = 2; i < indices.length; i++) {
      const diff = (((indices[i] - indices[i - 1]) % size) + size) % size;
      if (diff !== step) return null;
    }
    if (step === 0) return null;
  }

  const out: CellValue[] = [];
  let index = indices[indices.length - 1];
  for (let i = 0; i < count; i++) {
    index = (index + step) % list.length;
    // Регистр берём у последнего образца: «Понедельник» продолжается
    // «Вторником», а не «вторником».
    out.push(matchCase(list[index], texts[texts.length - 1]));
  }
  return out;
}

const NUMBERED_RE = /^(.*?)(\d+)(\D*)$/;

/** Ряд «Задача 1 → Задача 2»: одинаковые обрамления, число на конце. */
function numberedSeries(texts: string[], count: number): CellValue[] | null {
  const parts = texts.map((text) => NUMBERED_RE.exec(text));
  if (parts.some((part) => !part)) return null;

  const prefix = parts[0]![1];
  const suffix = parts[0]![3];
  if (parts.some((part) => part![1] !== prefix || part![3] !== suffix)) return null;

  const numbers = parts.map((part) => Number(part![2]));
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  const step = arithmeticStep(numbers) ?? (numbers.length === 1 ? 1 : null);
  if (step === null) return null;

  // Ведущие нули — часть кода, а не украшение: «007» продолжается «008».
  const width = parts[parts.length - 1]![2].length;
  const padded = parts.every((part) => part![2].length === width && part![2].startsWith("0"));

  const out: CellValue[] = [];
  const last = numbers[numbers.length - 1];
  for (let i = 1; i <= count; i++) {
    const value = last + step * i;
    if (value < 0) return null;
    const text = padded ? String(value).padStart(width, "0") : String(value);
    out.push(`${prefix}${text}${suffix}`);
  }
  return out;
}

/** Привести регистр к образцу: ВЕРХНИЙ, С Заглавной или как есть. */
function matchCase(value: string, sample: string): string {
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return value.toUpperCase();
  if (sample[0] && sample[0] === sample[0].toUpperCase() && sample[0] !== sample[0].toLowerCase()) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  return value;
}

/**
 * Строки и колонки, которых на экране нет: скрытые руками и отсеянные фильтром.
 * Протягивание обязано их пропускать — писать в невидимую строку значит менять
 * данные, которых человек не видит, и он об этом не узнает.
 */
export interface FillSkip {
  rows?: Set<number>;
  cols?: Set<number>;
}

const NOTHING_HIDDEN: Set<number> = new Set();

/**
 * Протянуть образец `source` до `target`.
 *
 * `target` включает в себя `source` — это прямоугольник, который человек
 * обвёл, потянув за уголок. Ось одна: тянут либо по строкам, либо по колонкам,
 * и диагональ разводится в пользу той, куда протянули дальше.
 */
export function fillRange(
  workbook: Workbook,
  sheetIndex: number,
  source: CellRange,
  target: CellRange,
  skip: FillSkip = {},
): Workbook {
  const next = cloneWorkbook(workbook);
  const sheet = next.sheets[sheetIndex];
  if (!sheet) return next;

  const down = target.r2 - source.r2;
  const up = source.r1 - target.r1;
  const right = target.c2 - source.c2;
  const left = source.c1 - target.c1;

  const vertical = Math.max(down, up) >= Math.max(right, left);
  if ((vertical ? Math.max(down, up) : Math.max(right, left)) <= 0) return next;
  const forward = vertical ? down >= up : right >= left;

  const hiddenAlong = (vertical ? skip.rows : skip.cols) ?? NOTHING_HIDDEN;
  const hiddenAcross = (vertical ? skip.cols : skip.rows) ?? NOTHING_HIDDEN;

  const from = vertical ? source.r1 : source.c1;
  const to = vertical ? source.r2 : source.c2;

  // Линии образца в порядке протягивания: назад он читается с конца.
  const patternLines: number[] = [];
  for (let line = from; line <= to; line++) if (!hiddenAlong.has(line)) patternLines.push(line);
  if (!forward) patternLines.reverse();
  if (!patternLines.length) return next;

  // Линии назначения — всё, что человек обвёл за пределами образца.
  const targetLines: number[] = [];
  if (forward) {
    const last = vertical ? target.r2 : target.c2;
    for (let line = to + 1; line <= last; line++) if (!hiddenAlong.has(line)) targetLines.push(line);
  } else {
    const first = vertical ? target.r1 : target.c1;
    for (let line = from - 1; line >= first; line--) {
      if (!hiddenAlong.has(line)) targetLines.push(line);
    }
  }
  if (!targetLines.length) return next;

  const acrossFrom = vertical ? source.c1 : source.r1;
  const acrossTo = vertical ? source.c2 : source.r2;
  const at = (along: number, across: number) =>
    vertical ? { row: along, col: across } : { row: across, col: along };

  let budget = FILL_LIMIT;

  for (let across = acrossFrom; across <= acrossTo; across++) {
    if (hiddenAcross.has(across)) continue;

    const pattern: Array<{ cell: SheetCell | undefined; row: number; col: number }> =
      patternLines.map((line) => {
        const { row, col } = at(line, across);
        return { cell: getCell(sheet, row, col), row, col };
      });

    const values = continueSeries(
      pattern.map(({ cell }) => ({
        value: cell?.v ?? null,
        fmt: styleOf(next, cell).fmt,
        formula: Boolean(cell?.f),
      })),
      targetLines.length,
    );

    targetLines.forEach((line, i) => {
      if (budget <= 0) return;
      const { row, col } = at(line, across);
      if (row < 0 || col < 0 || row >= sheet.rows || col >= sheet.cols) return;
      budget--;

      const source = pattern[i % pattern.length];
      // Пустая ячейка образца стирает то, поверх чего протянули: иначе под
      // разреженным образцом оставались бы обрывки прежних данных.
      if (!source.cell) {
        setCell(sheet, row, col, null);
        return;
      }

      const cell: SheetCell = {};
      if (source.cell.s !== undefined) cell.s = source.cell.s;
      if (source.cell.f) {
        cell.f = offsetFormula(source.cell.f, row - source.row, col - source.col);
      } else {
        cell.v = values[i] ?? null;
      }
      setCell(sheet, row, col, cell);
    });
  }

  return next;
}

/**
 * Докуда протягивать по двойному щелчку: до конца данных в соседней колонке.
 *
 * Соседняя — левая, а если её нет или она пуста, то правая: таблицу заполняют
 * слева направо, и колонка формул почти всегда стоит справа от той, ради
 * которой её пишут.
 */
export function fillDownExtent(
  workbook: Workbook,
  sheetIndex: number,
  source: CellRange,
  skip: FillSkip = {},
): number {
  const sheet = workbook.sheets[sheetIndex];
  if (!sheet) return source.r2;

  const hidden = skip.rows ?? NOTHING_HIDDEN;
  const neighbours = [source.c1 - 1, source.c2 + 1].filter(
    (col) => col >= 0 && col < sheet.cols && !(skip.cols ?? NOTHING_HIDDEN).has(col),
  );
  let best = source.r2;
  for (const col of neighbours) {
    let last = source.r2;
    for (let row = source.r2 + 1; row < sheet.rows; row++) {
      if (hidden.has(row)) continue;
      if (!getCell(sheet, row, col)) break;
      last = row;
    }
    if (last > best) best = last;
    if (best > source.r2) break;
  }
  return best;
}
