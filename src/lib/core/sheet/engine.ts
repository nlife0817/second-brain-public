// Пересчёт книги: какие ячейки от каких зависят, в каком порядке считать и что
// делать с циклом.
//
// Порядок строится обходом в глубину БЕЗ рекурсии. Это не украшательство:
// колонка накопительного итога (`=B2+C1`) на пять тысяч строк — обычное дело, а
// рекурсивный обход такой глубины кладёт стек браузера. Цена — явный стек и
// цветовая разметка узлов, зато поведение не зависит от размера книги.
//
// Значение формулы кэшируется в самой ячейке (`SheetCell.v`). Поэтому страница
// показывает числа сразу после загрузки, csv выгружается без движка, а поиск по
// базе знаний видит результат, а не текст формулы.

import {
  cellRef,
  parseRef,
  type CellValue,
  type SheetTab,
  type Workbook,
} from "./model";
import {
  ERR,
  FormulaError,
  isError,
  ParseError,
  parseFormula,
  collectReferences,
  type FormulaNode,
} from "./formula";
import {
  asMatrix,
  compareValues,
  FUNCTIONS,
  toBoolean,
  toNumber,
  toScalar,
  toText,
  type CallContext,
  type Matrix,
  type Scalar,
  type Value,
} from "./functions";

/** Результат пересчёта: значения формульных ячеек по адресу «лист:A1». */
export type ComputedValues = Map<string, Scalar>;

/** Ключ ячейки в пределах книги. Строка, а не объект: она же ключ карт и множеств. */
function keyOf(sheet: number, row: number, col: number): string {
  return `${sheet}:${cellRef(row, col)}`;
}

interface FormulaCell {
  sheet: number;
  row: number;
  col: number;
  key: string;
  node: FormulaNode;
}

/**
 * Пересчитать книгу целиком и записать результаты в ячейки.
 *
 * Пересчёт всегда полный, а не «от изменённой ячейки». Для наших пределов (до
 * 50 000 ячеек) это единицы миллисекунд, а инкрементальный пересчёт потребовал
 * бы хранить и чинить граф при каждой вставке строки — источник ошибок,
 * несопоставимый с выигрышем.
 */
export function recalculate(workbook: Workbook, now: Date = new Date()): ComputedValues {
  const formulas = collectFormulas(workbook);
  const byKey = new Map(formulas.map((cell) => [cell.key, cell]));
  const values: ComputedValues = new Map();

  const order = topologicalOrder(workbook, formulas, byKey, values);

  const sheetIndex = sheetIndexByName(workbook);
  for (const cell of order) {
    // Ячейка в цикле уже получила ошибку — считать её нечего.
    if (values.has(cell.key)) continue;
    const ctx: EvalContext = {
      workbook,
      sheet: cell.sheet,
      sheetIndex,
      values,
      byKey,
      call: { now, row: cell.row, col: cell.col },
    };
    values.set(cell.key, toScalar(evaluate(cell.node, ctx)));
  }

  applyValues(workbook, values);
  return values;
}

/** Записать посчитанное обратно в ячейки — ровно то, что уедет в базу. */
function applyValues(workbook: Workbook, values: ComputedValues): void {
  for (const [key, value] of values) {
    const [sheetPart, ref] = splitKey(key);
    const sheet = workbook.sheets[sheetPart];
    const cell = sheet?.cells[ref];
    if (!cell) continue;
    cell.v = toStored(value);
  }
}

function splitKey(key: string): [number, string] {
  const at = key.indexOf(":");
  return [Number(key.slice(0, at)), key.slice(at + 1)];
}

/** Значение движка → то, что можно положить в JSON книги. */
function toStored(value: Scalar): CellValue {
  if (isError(value)) return value.code;
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : "#NUM!";
  return value;
}

function collectFormulas(workbook: Workbook): FormulaCell[] {
  const out: FormulaCell[] = [];
  workbook.sheets.forEach((sheet, index) => {
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      if (!cell.f) continue;
      const at = parseRef(ref);
      if (!at) continue;
      let node: FormulaNode;
      try {
        node = parseFormula(cell.f);
      } catch (cause) {
        // Синтаксическая ошибка это не падение страницы: ячейка показывает
        // #NAME?, соседи считаются дальше.
        node = { k: "err", v: cause instanceof ParseError ? "#NAME?" : "#VALUE!" };
      }
      out.push({ sheet: index, row: at.row, col: at.col, key: keyOf(index, at.row, at.col), node });
    }
  });
  return out;
}

function sheetIndexByName(workbook: Workbook): Map<string, number> {
  const map = new Map<string, number>();
  workbook.sheets.forEach((sheet, index) => map.set(sheet.name.toLowerCase(), index));
  return map;
}

// --- Порядок пересчёта -----------------------------------------------------

/**
 * Топологический порядок: зависимости раньше зависящих. Циклы находятся здесь
 * же — участники сразу получают `#CYCLE!`, и вычислитель до них не доходит.
 */
function topologicalOrder(
  workbook: Workbook,
  formulas: FormulaCell[],
  byKey: Map<string, FormulaCell>,
  values: ComputedValues,
): FormulaCell[] {
  const sheetIndex = sheetIndexByName(workbook);
  // Формульные ячейки по листам — по ним ищется пересечение с диапазоном.
  const perSheet = new Map<number, FormulaCell[]>();
  for (const cell of formulas) {
    const list = perSheet.get(cell.sheet);
    if (list) list.push(cell);
    else perSheet.set(cell.sheet, [cell]);
  }

  const deps = new Map<string, string[]>();
  for (const cell of formulas) {
    const out = new Set<string>();
    for (const ref of collectReferences(cell.node)) {
      const target =
        ref.sheet === null ? cell.sheet : (sheetIndex.get(ref.sheet.toLowerCase()) ?? -1);
      if (target < 0) continue;
      const area = (ref.r2 - ref.r1 + 1) * (ref.c2 - ref.c1 + 1);
      const candidates = perSheet.get(target) ?? [];
      // Диапазон бывает шире, чем весь список формул листа: тогда дешевле
      // перебрать формулы и проверить попадание, чем обойти каждую клетку.
      if (area > candidates.length) {
        for (const candidate of candidates) {
          if (
            candidate.row >= ref.r1 &&
            candidate.row <= ref.r2 &&
            candidate.col >= ref.c1 &&
            candidate.col <= ref.c2
          ) {
            out.add(candidate.key);
          }
        }
      } else {
        for (let row = ref.r1; row <= ref.r2; row++) {
          for (let col = ref.c1; col <= ref.c2; col++) {
            const key = keyOf(target, row, col);
            if (byKey.has(key)) out.add(key);
          }
        }
      }
    }
    out.delete(cell.key); // ссылка на себя — это тоже цикл, но её ловим ниже
    deps.set(cell.key, [...out]);
    if (collectReferences(cell.node).some((r) => selfReference(cell, r, sheetIndex))) {
      values.set(cell.key, ERR.cycle);
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const order: FormulaCell[] = [];

  for (const start of formulas) {
    if (color.get(start.key) === BLACK) continue;
    // Явный стек вместо рекурсии: глубина цепочки равна высоте таблицы.
    const stack: Array<{ key: string; index: number }> = [{ key: start.key, index: 0 }];
    color.set(start.key, GRAY);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const children = deps.get(frame.key) ?? [];
      if (frame.index < children.length) {
        const child = children[frame.index++];
        const state = color.get(child) ?? WHITE;
        if (state === GRAY) {
          // Ребро в «серый» узел замыкает цикл: помечаем всех, кто на стеке
          // от этого узла и выше, — считать их нельзя ни в каком порядке.
          const from = stack.findIndex((f) => f.key === child);
          for (let i = Math.max(0, from); i < stack.length; i++) {
            values.set(stack[i].key, ERR.cycle);
          }
          continue;
        }
        if (state === WHITE) {
          color.set(child, GRAY);
          stack.push({ key: child, index: 0 });
        }
        continue;
      }
      color.set(frame.key, BLACK);
      const cell = byKey.get(frame.key);
      if (cell) order.push(cell);
      stack.pop();
    }
  }

  return order;
}

function selfReference(
  cell: FormulaCell,
  ref: { sheet: string | null; r1: number; c1: number; r2: number; c2: number },
  sheetIndex: Map<string, number>,
): boolean {
  const target = ref.sheet === null ? cell.sheet : (sheetIndex.get(ref.sheet.toLowerCase()) ?? -1);
  if (target !== cell.sheet) return false;
  return cell.row >= ref.r1 && cell.row <= ref.r2 && cell.col >= ref.c1 && cell.col <= ref.c2;
}

// --- Вычисление ------------------------------------------------------------

interface EvalContext {
  workbook: Workbook;
  /** Лист считаемой ячейки: ссылки без имени листа разрешаются в него. */
  sheet: number;
  sheetIndex: Map<string, number>;
  values: ComputedValues;
  byKey: Map<string, FormulaCell>;
  call: CallContext;
}

function evaluate(node: FormulaNode, ctx: EvalContext): Value {
  switch (node.k) {
    case "num":
      return node.v;
    case "str":
      return node.v;
    case "bool":
      return node.v;
    case "err":
      return new FormulaError(node.v);
    case "ref": {
      const sheet = resolveSheet(node.sheet, ctx);
      if (sheet < 0) return ERR.ref;
      return valueAt(ctx, sheet, node.row, node.col);
    }
    case "range": {
      const sheet = resolveSheet(node.sheet, ctx);
      if (sheet < 0) return ERR.ref;
      const matrix: Matrix = [];
      for (let row = node.r1; row <= node.r2; row++) {
        const line: Scalar[] = [];
        for (let col = node.c1; col <= node.c2; col++) line.push(valueAt(ctx, sheet, row, col));
        matrix.push(line);
      }
      return matrix;
    }
    case "neg": {
      const x = toNumber(evaluate(node.x, ctx));
      return isError(x) ? x : -x;
    }
    case "pct": {
      const x = toNumber(evaluate(node.x, ctx));
      return isError(x) ? x : x / 100;
    }
    case "bin":
      return binary(node.op, evaluate(node.a, ctx), evaluate(node.b, ctx));
    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) return ERR.name;
      // Аргументы вычисляются заранее — ленивых функций у нас нет; IF считает
      // обе ветки, и это заметно только на ошибке в неиспользуемой ветке.
      const args = node.args.map((arg) => evaluate(arg, ctx));
      const failed = args.find((arg) => isError(toScalarSafe(arg)));
      // Ошибку в аргументе пропускают только функции, которые её обрабатывают.
      if (failed !== undefined && !ERROR_TOLERANT.has(node.name)) {
        return toScalarSafe(failed);
      }
      return fn(args, ctx.call);
    }
  }
}

/** Функции, которым ошибка в аргументе — это данные, а не повод сдаться. */
const ERROR_TOLERANT = new Set(["IFERROR", "IFNA", "ISERROR", "ISNA", "ISBLANK", "COUNT", "COUNTA"]);

function toScalarSafe(value: Value): Scalar {
  const scalar = toScalar(value);
  return scalar;
}

function resolveSheet(name: string | null, ctx: EvalContext): number {
  if (name === null) return ctx.sheet;
  return ctx.sheetIndex.get(name.toLowerCase()) ?? -1;
}

/**
 * Значение ячейки для формулы: у формульной берётся посчитанное, у обычной —
 * записанное. Ячейка, которую ещё не посчитали (осталась в цикле), отдаёт
 * ошибку цикла, а не старое значение.
 */
function valueAt(ctx: EvalContext, sheet: number, row: number, col: number): Scalar {
  const tab: SheetTab | undefined = ctx.workbook.sheets[sheet];
  if (!tab) return ERR.ref;
  if (row < 0 || col < 0) return ERR.ref;
  const key = keyOf(sheet, row, col);
  if (ctx.byKey.has(key)) {
    const computed = ctx.values.get(key);
    return computed === undefined ? ERR.cycle : computed;
  }
  const cell = tab.cells[cellRef(row, col)];
  if (!cell || cell.v === undefined || cell.v === null) return null;
  // Текст ошибки, лежащий в ячейке значением, снова становится ошибкой:
  // иначе SUM по колонке с #DIV/0! молча посчитал бы строки как текст.
  if (typeof cell.v === "string" && cell.v.startsWith("#") && cell.v.endsWith("!")) {
    return asErrorOrText(cell.v);
  }
  return cell.v;
}

function asErrorOrText(text: string): Scalar {
  switch (text) {
    case "#VALUE!":
      return ERR.value;
    case "#DIV/0!":
      return ERR.div0;
    case "#REF!":
      return ERR.ref;
    case "#NUM!":
      return ERR.num;
    case "#CYCLE!":
      return ERR.cycle;
    default:
      return text;
  }
}

function binary(op: string, left: Value, right: Value): Value {
  if (op === "&") {
    const a = toText(left);
    if (isError(a)) return a;
    const b = toText(right);
    if (isError(b)) return b;
    return a + b;
  }

  if (op === "=" || op === "<>" || op === "<" || op === ">" || op === "<=" || op === ">=") {
    const a = toScalar(left);
    const b = toScalar(right);
    if (isError(a)) return a;
    if (isError(b)) return b;
    const cmp = compareValues(a, b);
    switch (op) {
      case "=":
        return cmp === 0;
      case "<>":
        return cmp !== 0;
      case "<":
        return cmp < 0;
      case ">":
        return cmp > 0;
      case "<=":
        return cmp <= 0;
      default:
        return cmp >= 0;
    }
  }

  const a = toNumber(left);
  if (isError(a)) return a;
  const b = toNumber(right);
  if (isError(b)) return b;
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return b === 0 ? ERR.div0 : a / b;
    case "^": {
      const result = a ** b;
      return Number.isFinite(result) ? result : ERR.num;
    }
    default:
      return ERR.value;
  }
}

// --- Точечное вычисление ---------------------------------------------------

/**
 * Посчитать одну формулу в контексте книги — этим живут строка формул при
 * предпросмотре и тесты. Полный пересчёт для одной ячейки избыточен, но
 * зависимости от других формул он всё равно обязан увидеть, поэтому книга
 * пересчитывается, а результат берётся из карты.
 */
export function evaluateFormula(
  workbook: Workbook,
  sheetIndexNumber: number,
  formula: string,
  at: { row: number; col: number } = { row: 0, col: 0 },
  now: Date = new Date(),
): Scalar {
  const values = recalculate(workbook, now);
  const formulas = collectFormulas(workbook);
  const byKey = new Map(formulas.map((cell) => [cell.key, cell]));
  let node: FormulaNode;
  try {
    node = parseFormula(formula);
  } catch {
    return ERR.name;
  }
  const ctx: EvalContext = {
    workbook,
    sheet: sheetIndexNumber,
    sheetIndex: sheetIndexByName(workbook),
    values,
    byKey,
    call: { now, row: at.row, col: at.col },
  };
  return toScalar(evaluate(node, ctx));
}

/** Матрица значений диапазона — нужна сортировке и фильтрам. */
export function rangeValues(workbook: Workbook, sheet: number, ref: string): Matrix {
  const values = recalculate(workbook);
  const formulas = collectFormulas(workbook);
  const byKey = new Map(formulas.map((cell) => [cell.key, cell]));
  const ctx: EvalContext = {
    workbook,
    sheet,
    sheetIndex: sheetIndexByName(workbook),
    values,
    byKey,
    call: { now: new Date(), row: 0, col: 0 },
  };
  let node: FormulaNode;
  try {
    node = parseFormula(ref);
  } catch {
    return [[ERR.ref]];
  }
  return asMatrix(evaluate(node, ctx));
}

export { toBoolean };
