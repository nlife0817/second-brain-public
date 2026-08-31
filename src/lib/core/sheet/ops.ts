// Операции над листом: строки и колонки, оформление, объединение, сортировка и
// фильтры.
//
// Всё здесь — чистые функции над книгой: принимают книгу, возвращают новую.
// Редактор держит историю отмен стопкой прошлых состояний, и мутация на месте
// сделала бы её бессмысленной. Копирование книги целиком выглядит расточительно,
// но при потолке в 50 000 ячеек это доли миллисекунды, а альтернатива —
// ручное управление неизменяемостью в каждой операции.
//
// Главная тонкость — ссылки. Вставка строки обязана подвинуть формулы во ВСЕЙ
// книге, а не только на своём листе: `=Лист2!A10` с другого листа тоже смотрит
// на подвинувшуюся ячейку.

import {
  formulaToText,
  mapReferences,
  offsetFormula,
  parseFormula,
  type FormulaNode,
} from "./formula";
import {
  BORDER_SIDES,
  cellRef,
  getCell,
  isBlankCell,
  parseRange,
  parseRef,
  rangeCells,
  rangeContains,
  rangeRef,
  SHEET_LIMITS,
  setCell,
  usedBounds,
  type BorderSide,
  type CellRange,
  type CellStyle,
  type SheetCell,
  type SheetTab,
  type Workbook,
} from "./model";

/** Глубокая копия книги. JSON — самый дешёвый способ: внутри только данные. */
export function cloneWorkbook(workbook: Workbook): Workbook {
  return JSON.parse(JSON.stringify(workbook)) as Workbook;
}

// --- Оформление ------------------------------------------------------------

/** Канонический ключ стиля — по нему одинаковые стили склеиваются в один. */
function styleKey(style: CellStyle): string {
  const entries = Object.entries(style)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

/**
 * Индекс стиля в книге; одинаковые стили не дублируются.
 *
 * `cache` обязателен там, где стиль ставится сотням ячеек подряд: без него
 * каждая ячейка перебирает всю таблицу стилей, пересобирая ключ строкой, и
 * оформление колонки превращается в квадратичную работу.
 */
export function styleIndex(
  workbook: Workbook,
  style: CellStyle,
  cache?: Map<string, number>,
): number | undefined {
  const key = styleKey(style);
  if (key === "[]") return undefined;

  const known = cache ? cache.get(key) : undefined;
  if (known !== undefined) return known;
  if (!cache) {
    const existing = workbook.styles.findIndex((item) => styleKey(item) === key);
    if (existing >= 0) return existing;
  }
  const index = workbook.styles.push(style) - 1;
  cache?.set(key, index);
  return index;
}

/** Карта «стиль → индекс» по уже заведённым стилям книги. */
function styleCacheOf(workbook: Workbook): Map<string, number> {
  const cache = new Map<string, number>();
  workbook.styles.forEach((style, index) => {
    const key = styleKey(style);
    if (!cache.has(key)) cache.set(key, index);
  });
  return cache;
}

/**
 * Докуда оформление имеет смысл: заполненная область плюс запас на дописывание.
 *
 * Ниже и правее лежит пустота до края листа, и заливать её стилем — значит
 * завести сотни тысяч ячеек ради того, чего не видно. На выделении «весь лист»
 * (Ctrl+A) это не просто расход памяти: книга перешагнула бы предел в 50 000
 * ячеек, и при следующем сохранении нормализация отрезала бы хвост — вместе с
 * настоящими данными.
 */
const STYLE_MARGIN_ROWS = 200;
const STYLE_MARGIN_COLS = 10;
/** Сколько пустых ячеек за раз можно завести ради одного лишь оформления. */
const STYLE_NEW_CELLS = 5000;

function styleableArea(sheet: SheetTab): CellRange {
  const used = usedBounds(sheet);
  return {
    r1: 0,
    c1: 0,
    r2: Math.min(sheet.rows - 1, (used?.row ?? 0) + STYLE_MARGIN_ROWS),
    c2: Math.min(sheet.cols - 1, (used?.col ?? 0) + STYLE_MARGIN_COLS),
  };
}

export function styleOf(workbook: Workbook, cell: SheetCell | undefined): CellStyle {
  if (!cell || cell.s === undefined) return {};
  return workbook.styles[cell.s] ?? {};
}

/**
 * Применить правку оформления к области. `null` в поле снимает свойство —
 * иначе «убрать жирный» было бы нечем выразить.
 */
export function applyStyle(
  workbook: Workbook,
  sheetIndex: number,
  ranges: CellRange[],
  patch: Partial<Record<keyof CellStyle, unknown>>,
): Workbook {
  const next = cloneWorkbook(workbook);
  const sheet = next.sheets[sheetIndex];
  if (!sheet) return next;

  const brush = brushOf(next, sheet);
  for (const range of ranges) {
    for (const { row, col } of rangeCells(range)) brush.paint(row, col, patch);
  }

  return dropUnusedStyles(next);
}

/**
 * Кисть по ячейкам одного листа: держит кэш стилей, границы разумной области и
 * запас на создание пустых ячеек.
 *
 * Отдельно от `applyStyle`, потому что границам нужен СВОЙ набор свойств для
 * каждой ячейки области (у верхней строки — верхняя линия, у нижней — нижняя), и
 * без общей кисти это была бы вторая копия тех же трёх правил про бюджет, кэш и
 * пустые ячейки.
 */
interface StyleBrush {
  /** `null`/`undefined` в поле снимает свойство; отсутствие поля — не трогает. */
  paint: (row: number, col: number, patch: Partial<Record<keyof CellStyle, unknown>>) => void;
  /** То же, но только для уже существующих ячеек: пустые не заводятся. */
  paintExisting: (row: number, col: number, patch: Partial<Record<keyof CellStyle, unknown>>) => void;
}

function brushOf(workbook: Workbook, sheet: SheetTab): StyleBrush {
  const cache = styleCacheOf(workbook);
  const area = styleableArea(sheet);
  let budget = STYLE_NEW_CELLS;

  const paint = (
    row: number,
    col: number,
    patch: Partial<Record<keyof CellStyle, unknown>>,
    onlyExisting = false,
  ) => {
    if (row < 0 || col < 0 || row >= sheet.rows || col >= sheet.cols) return;
    const cell = getCell(sheet, row, col);
    // Заполненная ячейка перекрашивается всегда: новых записей от этого не
    // прибавляется. Пустая — только рядом с данными и пока хватает запаса.
    if (!cell) {
      if (onlyExisting) return;
      if (!rangeContains(area, row, col) || budget <= 0) return;
      budget--;
    }
    const style: CellStyle = { ...styleOf(workbook, cell) };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === false) {
        delete style[key as keyof CellStyle];
      } else {
        (style as Record<string, unknown>)[key] = value;
      }
    }
    const index = styleIndex(workbook, style, cache);
    const updated: SheetCell = { ...(cell ?? {}) };
    if (index === undefined) delete updated.s;
    else updated.s = index;
    setCell(sheet, row, col, isBlankCell(updated) ? null : updated);
  };

  return {
    paint: (row, col, patch) => paint(row, col, patch),
    paintExisting: (row, col, patch) => paint(row, col, patch, true),
  };
}

// --- Границы ---------------------------------------------------------------

export type BorderPreset =
  | "all"
  | "outer"
  | "inner"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "none";

/** Цвет линии по умолчанию — тот же чёрный, что первым стоит в палитре текста. */
export const DEFAULT_BORDER_COLOR = "#111827";

/**
 * Границы области.
 *
 * Линия между двумя ячейками принадлежит ВЕРХНЕЙ и ЛЕВОЙ из них: отрисовка
 * читает `bb` ячейки, а если его нет — `bt` соседа снизу. Поэтому «внутренние»
 * ставят только `bb` и `br`, и одна и та же линия никогда не рисуется дважды —
 * иначе рамка внутри выделения выходила бы вдвое толще внешней.
 *
 * «Без границ» снимает и примыкающие стороны у соседей: линия под выделением
 * может быть записана в ячейке выше, и оставить её значит не убрать рамку.
 */
export function applyBorders(
  workbook: Workbook,
  sheetIndex: number,
  range: CellRange,
  preset: BorderPreset,
  color: string = DEFAULT_BORDER_COLOR,
): Workbook {
  const next = cloneWorkbook(workbook);
  const sheet = next.sheets[sheetIndex];
  if (!sheet) return next;
  const brush = brushOf(next, sheet);

  if (preset === "none") {
    const clear: Record<string, null> = {};
    for (const side of BORDER_SIDES) clear[side] = null;
    for (const { row, col } of rangeCells(range)) brush.paint(row, col, clear);
    for (let col = range.c1; col <= range.c2; col++) {
      brush.paintExisting(range.r1 - 1, col, { bb: null });
      brush.paintExisting(range.r2 + 1, col, { bt: null });
    }
    for (let row = range.r1; row <= range.r2; row++) {
      brush.paintExisting(row, range.c1 - 1, { br: null });
      brush.paintExisting(row, range.c2 + 1, { bl: null });
    }
    return dropUnusedStyles(next);
  }

  for (const { row, col } of rangeCells(range)) {
    const patch: Partial<Record<BorderSide, string>> = {};
    const first = { row: row === range.r1, col: col === range.c1 };
    const last = { row: row === range.r2, col: col === range.c2 };

    if (preset === "all") {
      patch.bt = color;
      patch.bb = color;
      patch.bl = color;
      patch.br = color;
    }
    if (preset === "outer") {
      if (first.row) patch.bt = color;
      if (last.row) patch.bb = color;
      if (first.col) patch.bl = color;
      if (last.col) patch.br = color;
    }
    if (preset === "inner") {
      if (!last.row) patch.bb = color;
      if (!last.col) patch.br = color;
    }
    if (preset === "top" && first.row) patch.bt = color;
    if (preset === "bottom" && last.row) patch.bb = color;
    if (preset === "left" && first.col) patch.bl = color;
    if (preset === "right" && last.col) patch.br = color;

    if (Object.keys(patch).length) brush.paint(row, col, patch);
  }

  return dropUnusedStyles(next);
}

/** Убрать стили, на которые никто не ссылается: иначе таблица стилей растёт вечно. */
export function dropUnusedStyles(workbook: Workbook): Workbook {
  const used = new Set<number>();
  for (const sheet of workbook.sheets) {
    for (const cell of Object.values(sheet.cells)) {
      if (cell.s !== undefined) used.add(cell.s);
    }
  }
  if (used.size === workbook.styles.length) return workbook;

  const remap = new Map<number, number>();
  const styles: CellStyle[] = [];
  for (const index of [...used].sort((a, b) => a - b)) {
    const style = workbook.styles[index];
    if (!style) continue;
    remap.set(index, styles.push(style) - 1);
  }
  for (const sheet of workbook.sheets) {
    for (const cell of Object.values(sheet.cells)) {
      if (cell.s === undefined) continue;
      const next = remap.get(cell.s);
      if (next === undefined) delete cell.s;
      else cell.s = next;
    }
  }
  workbook.styles = styles;
  return workbook;
}

// --- Строки и колонки ------------------------------------------------------

type Axis = "row" | "col";

/**
 * Вставка и удаление строк или колонок одной механикой: сдвигаются ячейки,
 * размеры, объединения и ссылки во всей книге. Разводить это на четыре
 * похожие функции — верный способ починить сдвиг в одной и забыть в трёх.
 *
 * `count > 0` — вставка, `count < 0` — удаление.
 */
function shiftLines(
  workbook: Workbook,
  sheetIndex: number,
  axis: Axis,
  at: number,
  count: number,
): Workbook {
  const next = cloneWorkbook(workbook);
  const sheet = next.sheets[sheetIndex];
  if (!sheet || count === 0) return next;

  const removing = count < 0;
  const size = Math.abs(count);
  const limit = axis === "row" ? SHEET_LIMITS.rows : SHEET_LIMITS.cols;
  const total = axis === "row" ? sheet.rows : sheet.cols;

  // Куда уезжает координата. `null` — строка удалена.
  const move = (value: number): number | null => {
    if (removing) {
      if (value >= at && value < at + size) return null;
      return value > at ? value - size : value;
    }
    return value >= at ? value + size : value;
  };

  const cells: Record<string, SheetCell> = {};
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const point = parseRef(ref);
    if (!point) continue;
    const row = axis === "row" ? move(point.row) : point.row;
    const col = axis === "col" ? move(point.col) : point.col;
    if (row === null || col === null) continue;
    if (row >= limit || col >= SHEET_LIMITS.cols) continue;
    cells[cellRef(row, col)] = cell;
  }
  sheet.cells = cells;

  sheet.widths = shiftSizes(sheet.widths, axis === "col" ? move : null);
  sheet.heights = shiftSizes(sheet.heights, axis === "row" ? move : null);
  sheet.hiddenR = shiftHidden(sheet.hiddenR, axis === "row" ? move : null);
  sheet.hiddenC = shiftHidden(sheet.hiddenC, axis === "col" ? move : null);

  if (sheet.merges) {
    const merges: string[] = [];
    for (const item of sheet.merges) {
      const range = parseRange(item);
      if (!range) continue;
      const r1 = axis === "row" ? move(range.r1) : range.r1;
      const r2 = axis === "row" ? move(range.r2) : range.r2;
      const c1 = axis === "col" ? move(range.c1) : range.c1;
      const c2 = axis === "col" ? move(range.c2) : range.c2;
      // Объединение, у которого срезали край, схлопывается — восстановить его
      // «как было» всё равно нечем.
      if (r1 === null || r2 === null || c1 === null || c2 === null) continue;
      if (r1 === r2 && c1 === c2) continue;
      merges.push(rangeRef({ r1, c1, r2, c2 }));
    }
    sheet.merges = merges.length ? merges : undefined;
  }

  if (axis === "row") sheet.rows = Math.min(limit, Math.max(1, total + count));
  else sheet.cols = Math.min(limit, Math.max(1, total + count));

  retargetFormulas(next, sheetIndex, axis, at, count);
  return next;
}

function shiftSizes(
  sizes: Record<string, number> | undefined,
  move: ((value: number) => number | null) | null,
): Record<string, number> | undefined {
  if (!sizes || !move) return sizes;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(sizes)) {
    const moved = move(Number(key));
    if (moved === null || moved < 0) continue;
    out[String(moved)] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function shiftHidden(
  hidden: number[] | undefined,
  move: ((value: number) => number | null) | null,
): number[] | undefined {
  if (!hidden || !move) return hidden;
  const out: number[] = [];
  for (const line of hidden) {
    const moved = move(line);
    if (moved === null || moved < 0) continue;
    out.push(moved);
  }
  return out.length ? out : undefined;
}

/**
 * Подвинуть ссылки во всей книге вслед за вставкой или удалением. Формула на
 * соседнем листе тоже смотрит на этот — поэтому обходим все листы, но правим
 * только ссылки, ведущие на изменённый.
 */
function retargetFormulas(
  workbook: Workbook,
  sheetIndex: number,
  axis: Axis,
  at: number,
  count: number,
): void {
  const target = workbook.sheets[sheetIndex];
  if (!target) return;
  const removing = count < 0;
  const size = Math.abs(count);

  workbook.sheets.forEach((sheet, index) => {
    for (const cell of Object.values(sheet.cells)) {
      if (!cell.f) continue;
      let node: FormulaNode;
      try {
        node = parseFormula(cell.f);
      } catch {
        continue;
      }
      const moved = mapReferences(node, (ref) => {
        // Ссылка без имени листа смотрит на свой лист.
        const points = ref.sheet === null ? index === sheetIndex : ref.sheet === target.name;
        if (!points) return { row: ref.row, col: ref.col };
        const value = axis === "row" ? ref.row : ref.col;
        let next: number;
        if (removing) {
          if (value >= at && value < at + size) return null;
          next = value > at ? value - size : value;
        } else {
          next = value >= at ? value + size : value;
        }
        return axis === "row" ? { row: next, col: ref.col } : { row: ref.row, col: next };
      });
      cell.f = formulaToText(moved);
    }
  });
}

export function insertRows(workbook: Workbook, sheet: number, at: number, count = 1): Workbook {
  return shiftLines(workbook, sheet, "row", at, count);
}

export function deleteRows(workbook: Workbook, sheet: number, at: number, count = 1): Workbook {
  return shiftLines(workbook, sheet, "row", at, -count);
}

export function insertColumns(workbook: Workbook, sheet: number, at: number, count = 1): Workbook {
  return shiftLines(workbook, sheet, "col", at, count);
}

export function deleteColumns(workbook: Workbook, sheet: number, at: number, count = 1): Workbook {
  return shiftLines(workbook, sheet, "col", at, -count);
}

/** Дорастить лист до нужного размера — вставка данных за краем должна работать. */
export function ensureSize(sheet: SheetTab, rows: number, cols: number): void {
  sheet.rows = Math.min(SHEET_LIMITS.rows, Math.max(sheet.rows, rows));
  sheet.cols = Math.min(SHEET_LIMITS.cols, Math.max(sheet.cols, cols));
}

// --- Объединение -----------------------------------------------------------

export function mergeRange(workbook: Workbook, sheetIndex: number, range: CellRange): Workbook {
  const next = cloneWorkbook(workbook);
  const sheet = next.sheets[sheetIndex];
  if (!sheet) return next;
  if (range.r1 === range.r2 && range.c1 === range.c2) return next;

  // Пересекающиеся объединения снимаем: две наложенные области не нарисовать.
  sheet.merges = (sheet.merges ?? []).filter((item) => {
    const existing = parseRange(item);
    if (!existing) return false;
    return !overlaps(existing, range);
  });

  // Живёт только левая верхняя ячейка — как в Excel.
  for (const { row, col } of rangeCells(range)) {
    if (row === range.r1 && col === range.c1) continue;
    setCell(sheet, row, col, null);
  }
  sheet.merges.push(rangeRef(range));
  return next;
}

export function unmergeRange(workbook: Workbook, sheetIndex: number, range: CellRange): Workbook {
  const next = cloneWorkbook(workbook);
  const sheet = next.sheets[sheetIndex];
  if (!sheet?.merges) return next;
  sheet.merges = sheet.merges.filter((item) => {
    const existing = parseRange(item);
    return existing ? !overlaps(existing, range) : false;
  });
  if (!sheet.merges.length) sheet.merges = undefined;
  return next;
}

function overlaps(a: CellRange, b: CellRange): boolean {
  return a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1;
}

/** Объединение, накрывающее ячейку. Нужно и отрисовке, и переходу курсора. */
export function mergeAt(sheet: SheetTab, row: number, col: number): CellRange | null {
  for (const item of sheet.merges ?? []) {
    const range = parseRange(item);
    if (!range) continue;
    if (row >= range.r1 && row <= range.r2 && col >= range.c1 && col <= range.c2) return range;
  }
  return null;
}

// --- Сортировка ------------------------------------------------------------

/**
 * Отсортировать строки диапазона по колонке.
 *
 * Сортируются целые строки диапазона, а не одна колонка: сортировка одной
 * колонки рвёт соответствие данных и делает таблицу неверной молча. Формулы
 * внутри переезжают со сдвигом относительных ссылок — как при переносе.
 */
export function sortRange(
  workbook: Workbook,
  sheetIndex: number,
  range: CellRange,
  column: number,
  direction: "asc" | "desc",
  compare: (a: SheetCell | undefined, b: SheetCell | undefined) => number,
): Workbook {
  const next = cloneWorkbook(workbook);
  const sheet = next.sheets[sheetIndex];
  if (!sheet) return next;

  const rows: Array<{ from: number; cells: Array<SheetCell | undefined> }> = [];
  for (let row = range.r1; row <= range.r2; row++) {
    const cells: Array<SheetCell | undefined> = [];
    for (let col = range.c1; col <= range.c2; col++) cells.push(getCell(sheet, row, col));
    rows.push({ from: row, cells });
  }

  const key = column - range.c1;
  const sorted = [...rows].sort((a, b) => {
    const result = compare(a.cells[key], b.cells[key]);
    // Устойчивость: равные строки сохраняют исходный порядок, иначе повторная
    // сортировка по другой колонке перемешивала бы то, что уже упорядочено.
    return (direction === "asc" ? result : -result) || a.from - b.from;
  });

  for (const { row, col } of rangeCells(range)) setCell(sheet, row, col, null);
  sorted.forEach((line, index) => {
    const row = range.r1 + index;
    const delta = row - line.from;
    line.cells.forEach((cell, offset) => {
      if (!cell) return;
      const moved: SheetCell = { ...cell };
      if (moved.f && delta !== 0) moved.f = offsetFormula(moved.f, delta, 0);
      setCell(sheet, row, range.c1 + offset, moved);
    });
  });

  sheet.sort = { col: column, dir: direction };
  return next;
}

// --- Фильтры ---------------------------------------------------------------

/**
 * Какие строки прячет фильтр. Возвращает множество, а не новый лист: фильтр —
 * это вид, а не правка данных, и снятие фильтра обязано вернуть всё как было.
 */
export function hiddenRows(
  sheet: SheetTab,
  displayed: (cell: SheetCell | undefined) => string,
  headerRow = 0,
): Set<number> {
  const hidden = new Set<number>();
  const filters = sheet.filters ?? [];
  if (!filters.length) return hidden;

  for (let row = headerRow + 1; row < sheet.rows; row++) {
    for (const filter of filters) {
      const text = displayed(getCell(sheet, row, filter.col));
      if (filter.values && filter.values.length && !filter.values.includes(text)) {
        hidden.add(row);
        break;
      }
      if (filter.contains && !text.toLowerCase().includes(filter.contains.toLowerCase())) {
        hidden.add(row);
        break;
      }
    }
  }
  return hidden;
}

/** Уникальные значения колонки — из них собирается список «галочек» фильтра. */
export function columnValues(
  sheet: SheetTab,
  col: number,
  displayed: (cell: SheetCell | undefined) => string,
  headerRow = 0,
): string[] {
  const seen = new Set<string>();
  for (let row = headerRow + 1; row < sheet.rows; row++) {
    seen.add(displayed(getCell(sheet, row, col)));
    if (seen.size > 1000) break;
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
}
