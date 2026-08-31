// Разбор формул: строка «SUM(A1:A10)*2» → дерево, которое умеет считать
// engine.ts.
//
// Свой парсер, а не библиотека, сознательно. Готовые (fast-formula-parser и
// родня) тянут moment и chevrotain, не обновлялись годами и всё равно требуют
// своего резолвера ссылок — то есть экономят разбор выражения, но не работу
// вокруг него. Грамматика формул при этом маленькая и полностью описывается
// таблицей приоритетов; зато она наша, покрыта тестами и не весит в бандле.
//
// Синтаксис — эксель-совместимый: ссылки A1 и $A$1, диапазоны A1:B2, ссылки на
// лист «Лист2!A1» и «'Мой лист'!A1:B2», операторы + - * / ^ & % и сравнения,
// вызовы функций через запятую или точку с запятой (в русской раскладке Excel
// разделитель именно такой, и человек напишет привычное).

/** Коды ошибок — те же, что показывает Excel, плюс свой на циклическую ссылку. */
export const ERROR_CODES = [
  "#VALUE!",
  "#DIV/0!",
  "#REF!",
  "#NAME?",
  "#N/A",
  "#NUM!",
  "#CYCLE!",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Ошибка вычисления. Отдельный класс, чтобы её нельзя было спутать со строкой. */
export class FormulaError {
  constructor(readonly code: ErrorCode) {}
  toString(): string {
    return this.code;
  }
}

export const ERR = {
  value: new FormulaError("#VALUE!"),
  div0: new FormulaError("#DIV/0!"),
  ref: new FormulaError("#REF!"),
  name: new FormulaError("#NAME?"),
  na: new FormulaError("#N/A"),
  num: new FormulaError("#NUM!"),
  cycle: new FormulaError("#CYCLE!"),
} as const;

export function isError(value: unknown): value is FormulaError {
  return value instanceof FormulaError;
}

// --- Дерево ----------------------------------------------------------------

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "^"
  | "&"
  | "="
  | "<>"
  | "<"
  | ">"
  | "<="
  | ">=";

/**
 * Признаки «доллара» у ссылки. Хранятся, а не выбрасываются, потому что от них
 * зависит копирование формул: при протягивании вниз `A1` едет за формулой, а
 * `$A$1` остаётся на месте. Без этих флагов копирование ломало бы любую
 * таблицу со ссылкой на курс или ставку в отдельной ячейке.
 */
export interface RefAnchors {
  rowAbs?: true;
  colAbs?: true;
}

export type FormulaNode =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "err"; v: ErrorCode }
  /** Ссылка на ячейку. `sheet` — имя листа или `null`, если лист свой. */
  | ({ k: "ref"; sheet: string | null; row: number; col: number } & RefAnchors)
  | {
      k: "range";
      sheet: string | null;
      r1: number;
      c1: number;
      r2: number;
      c2: number;
      from?: RefAnchors;
      to?: RefAnchors;
    }
  | { k: "neg"; x: FormulaNode }
  | { k: "pct"; x: FormulaNode }
  | { k: "bin"; op: BinaryOp; a: FormulaNode; b: FormulaNode }
  | { k: "call"; name: string; args: FormulaNode[] };

export class ParseError extends Error {}

// --- Лексер ----------------------------------------------------------------

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; sheet: string | null; ref: string }
  | { t: "name"; v: string }
  | { t: "err"; v: ErrorCode }
  | { t: "op"; v: string }
  | { t: "("; }
  | { t: ")"; }
  | { t: ","; }
  | { t: "end" };

const OPERATORS = ["<=", ">=", "<>", "+", "-", "*", "/", "^", "&", "=", "<", ">", "%"];

/** Имя листа перед «!»: «Лист2» или «'Мой лист'». */
const SHEET_PREFIX = /^(?:'((?:[^']|'')*)'|([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_. ]*))!/;
const CELL = /^\$?[A-Za-z]{1,3}\$?\d{1,7}/;
const NAME = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_.]*/;

function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let rest = input;

  const take = (n: number) => {
    rest = rest.slice(n);
  };

  while (rest.length) {
    const ch = rest[0];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      take(1);
      continue;
    }

    if (ch === "(") {
      out.push({ t: "(" });
      take(1);
      continue;
    }
    if (ch === ")") {
      out.push({ t: ")" });
      take(1);
      continue;
    }
    // Точка с запятой — разделитель аргументов русского Excel. Принимаем оба.
    if (ch === "," || ch === ";") {
      out.push({ t: "," });
      take(1);
      continue;
    }

    if (ch === '"') {
      // Кавычка внутри строки удваивается — как в Excel.
      let i = 1;
      let value = "";
      let closed = false;
      while (i < rest.length) {
        if (rest[i] === '"') {
          if (rest[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        value += rest[i];
        i++;
      }
      if (!closed) throw new ParseError("Незакрытая кавычка");
      out.push({ t: "str", v: value });
      take(i);
      continue;
    }

    if (ch === "#") {
      const code = ERROR_CODES.find((c) => rest.toUpperCase().startsWith(c));
      if (!code) throw new ParseError("Неизвестная ошибка в формуле");
      out.push({ t: "err", v: code });
      take(code.length);
      continue;
    }

    // Число. Точка — десятичный разделитель; запятая им быть не может, она
    // разделяет аргументы.
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(rest[1] ?? ""))) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(rest);
      if (!m) throw new ParseError("Не разобрать число");
      out.push({ t: "num", v: Number(m[0]) });
      take(m[0].length);
      continue;
    }

    // Ссылка с именем листа. Проверяется раньше обычного имени: «Лист2!A1»
    // начинается как имя функции.
    const sheetMatch = SHEET_PREFIX.exec(rest);
    if (sheetMatch) {
      const after = rest.slice(sheetMatch[0].length);
      const cell = CELL.exec(after);
      if (cell) {
        const sheet = (sheetMatch[1] ?? sheetMatch[2] ?? "").replace(/''/g, "'");
        out.push({ t: "ref", sheet, ref: cell[0] });
        take(sheetMatch[0].length + cell[0].length);
        continue;
      }
    }

    // Ссылка на ячейку своего листа. Важно, что «A1» разбирается как ссылка, а
    // «SUM» — как имя: различает их следующий символ (цифра против скобки).
    const cell = CELL.exec(rest);
    if (cell && !/^[A-Za-zА-Яа-яЁё0-9_.]/.test(rest.slice(cell[0].length))) {
      out.push({ t: "ref", sheet: null, ref: cell[0] });
      take(cell[0].length);
      continue;
    }

    const name = NAME.exec(rest);
    if (name) {
      const upper = name[0].toUpperCase();
      if (upper === "TRUE" || upper === "ИСТИНА") {
        out.push({ t: "name", v: "TRUE" });
      } else if (upper === "FALSE" || upper === "ЛОЖЬ") {
        out.push({ t: "name", v: "FALSE" });
      } else {
        out.push({ t: "name", v: upper });
      }
      take(name[0].length);
      continue;
    }

    const op = OPERATORS.find((o) => rest.startsWith(o));
    if (op) {
      out.push({ t: "op", v: op });
      take(op.length);
      continue;
    }

    if (ch === ":") {
      out.push({ t: "op", v: ":" });
      take(1);
      continue;
    }

    throw new ParseError(`Непонятный символ «${ch}»`);
  }

  out.push({ t: "end" });
  return out;
}

// --- Парсер ----------------------------------------------------------------

/** Приоритеты бинарных операторов; выше число — крепче связывает. */
const PRECEDENCE: Record<string, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "&": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 5,
};

/**
 * Формула → дерево. Бросает `ParseError` на синтаксической ошибке: ячейка с
 * непонятной формулой должна показать `#NAME?`, а не молча посчитать не то.
 */
export function parseFormula(source: string): FormulaNode {
  const tokens = tokenize(source.replace(/^=/, ""));
  let at = 0;

  const peek = (): Token => tokens[at];
  const next = (): Token => tokens[at++];
  const expect = (t: Token["t"]) => {
    const token = next();
    if (token.t !== t) throw new ParseError(`Ожидалось «${t}»`);
    return token;
  };

  function parseExpression(minPrecedence = 0): FormulaNode {
    let left = parseUnary();
    for (;;) {
      const token = peek();
      if (token.t !== "op") break;
      const precedence = PRECEDENCE[token.v];
      if (precedence === undefined || precedence < minPrecedence) break;
      next();
      // Возведение в степень правоассоциативно, остальные — левоассоциативны.
      const right = parseExpression(token.v === "^" ? precedence : precedence + 1);
      left = { k: "bin", op: token.v as BinaryOp, a: left, b: right };
    }
    return left;
  }

  function parseUnary(): FormulaNode {
    const token = peek();
    if (token.t === "op" && (token.v === "-" || token.v === "+")) {
      next();
      const x = parseUnary();
      return token.v === "-" ? { k: "neg", x } : x;
    }
    return parsePostfix();
  }

  function parsePostfix(): FormulaNode {
    let node = parsePrimary();
    for (;;) {
      const token = peek();
      if (token.t === "op" && token.v === "%") {
        next();
        node = { k: "pct", x: node };
        continue;
      }
      break;
    }
    return node;
  }

  function parsePrimary(): FormulaNode {
    const token = next();

    if (token.t === "num") return { k: "num", v: token.v };
    if (token.t === "str") return { k: "str", v: token.v };
    if (token.t === "err") return { k: "err", v: token.v };

    if (token.t === "ref") {
      const from = refToPoint(token.ref);
      if (!from) return { k: "err", v: "#REF!" };
      // Диапазон: за ссылкой идёт двоеточие и вторая ссылка.
      const after = peek();
      if (after.t === "op" && after.v === ":") {
        next();
        const to = next();
        if (to.t !== "ref") throw new ParseError("После «:» ожидается ссылка");
        const point = refToPoint(to.ref);
        if (!point) return { k: "err", v: "#REF!" };
        // «B5:A1» — это тот же прямоугольник, что «A1:B5», но признаки доллара
        // обязаны уехать вместе со своим углом, а не остаться на месте.
        const topFirst = from.row <= point.row;
        const leftFirst = from.col <= point.col;
        return {
          k: "range",
          sheet: token.sheet,
          r1: Math.min(from.row, point.row),
          c1: Math.min(from.col, point.col),
          r2: Math.max(from.row, point.row),
          c2: Math.max(from.col, point.col),
          from: anchors(
            (topFirst ? from : point).rowAbs,
            (leftFirst ? from : point).colAbs,
          ),
          to: anchors(
            (topFirst ? point : from).rowAbs,
            (leftFirst ? point : from).colAbs,
          ),
        };
      }
      return {
        k: "ref",
        sheet: token.sheet,
        row: from.row,
        col: from.col,
        ...anchors(from.rowAbs, from.colAbs),
      };
    }

    if (token.t === "name") {
      if (token.v === "TRUE") return { k: "bool", v: true };
      if (token.v === "FALSE") return { k: "bool", v: false };
      // Имя без скобок — либо именованный диапазон (их нет), либо опечатка.
      if (peek().t !== "(") return { k: "err", v: "#NAME?" };
      next();
      const args: FormulaNode[] = [];
      if (peek().t !== ")") {
        for (;;) {
          args.push(parseExpression());
          const separator = peek();
          if (separator.t === ",") {
            next();
            continue;
          }
          break;
        }
      }
      expect(")");
      return { k: "call", name: token.v, args };
    }

    if (token.t === "(") {
      const inner = parseExpression();
      expect(")");
      return inner;
    }

    throw new ParseError("Неполное выражение");
  }

  const node = parseExpression();
  if (peek().t !== "end") throw new ParseError("Лишнее в конце формулы");
  return node;
}

function anchors(rowAbs: boolean, colAbs: boolean): RefAnchors {
  const out: RefAnchors = {};
  if (rowAbs) out.rowAbs = true;
  if (colAbs) out.colAbs = true;
  return out;
}

function refToPoint(
  ref: string,
): { row: number; col: number; rowAbs: boolean; colAbs: boolean } | null {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/.exec(ref);
  if (!m) return null;
  const row = Number(m[4]) - 1;
  if (row < 0) return null;
  let col = 0;
  for (const ch of m[2].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row, col: col - 1, colAbs: m[1] === "$", rowAbs: m[3] === "$" };
}

// --- Обратно в текст и перенос ссылок --------------------------------------

function colLetters(col: number): string {
  let out = "";
  let n = col;
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

function refText(row: number, col: number, anchor?: RefAnchors): string {
  if (row < 0 || col < 0) return "#REF!";
  return `${anchor?.colAbs ? "$" : ""}${colLetters(col)}${anchor?.rowAbs ? "$" : ""}${row + 1}`;
}

/** Имя листа в ссылке: с пробелом или точкой — только в апострофах. */
function sheetPrefix(name: string | null): string {
  if (name === null) return "";
  return /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/.test(name)
    ? `${name}!`
    : `'${name.replace(/'/g, "''")}'!`;
}

/**
 * Дерево → формула. Нужна везде, где ссылки едут: копирование, вставка и
 * удаление строк. Разбирать и собирать текст надёжнее, чем править его
 * регулярками: «A1» встречается и внутри строковой константы, и в имени
 * функции, и подменять его вслепую нельзя.
 */
export function formulaToText(node: FormulaNode): string {
  switch (node.k) {
    case "num":
      return String(node.v);
    case "str":
      return `"${node.v.replace(/"/g, '""')}"`;
    case "bool":
      return node.v ? "TRUE" : "FALSE";
    case "err":
      return node.v;
    case "ref":
      return sheetPrefix(node.sheet) + refText(node.row, node.col, node);
    case "range":
      return (
        sheetPrefix(node.sheet) +
        refText(node.r1, node.c1, node.from) +
        ":" +
        refText(node.r2, node.c2, node.to)
      );
    case "neg":
      return `-${wrap(node.x)}`;
    case "pct":
      return `${wrap(node.x)}%`;
    case "bin":
      return `${wrap(node.a)}${node.op}${wrap(node.b)}`;
    case "call":
      return `${node.name}(${node.args.map(formulaToText).join(";")})`;
  }
}

/**
 * Скобки вокруг вложенного выражения. Ставятся всегда, где есть операция:
 * восстанавливать минимальную расстановку по приоритетам можно, но любая
 * ошибка там меняет смысл формулы, а лишняя скобка — только её вид.
 */
function wrap(node: FormulaNode): string {
  const text = formulaToText(node);
  return node.k === "bin" ? `(${text})` : text;
}

/** Как перенести одну ссылку: новые координаты либо `null` — ссылка сломана. */
export type RefMapper = (input: {
  sheet: string | null;
  row: number;
  col: number;
  /** Ссылка помечена долларом — при копировании такая не едет. */
  rowAbs: boolean;
  colAbs: boolean;
}) => { row: number; col: number } | null;

/** Перестроить все ссылки формулы. Сломанная ссылка становится `#REF!`. */
export function mapReferences(node: FormulaNode, map: RefMapper): FormulaNode {
  switch (node.k) {
    case "ref": {
      const moved = map({
        sheet: node.sheet,
        row: node.row,
        col: node.col,
        rowAbs: node.rowAbs === true,
        colAbs: node.colAbs === true,
      });
      if (!moved) return { k: "err", v: "#REF!" };
      return { ...node, row: moved.row, col: moved.col };
    }
    case "range": {
      const from = map({
        sheet: node.sheet,
        row: node.r1,
        col: node.c1,
        rowAbs: node.from?.rowAbs === true,
        colAbs: node.from?.colAbs === true,
      });
      const to = map({
        sheet: node.sheet,
        row: node.r2,
        col: node.c2,
        rowAbs: node.to?.rowAbs === true,
        colAbs: node.to?.colAbs === true,
      });
      // Уехавший угол диапазона — это не `#REF!` целиком: диапазон сжимается,
      // как в Excel, и остаётся считаемым.
      if (!from && !to) return { k: "err", v: "#REF!" };
      const r1 = from?.row ?? node.r1;
      const c1 = from?.col ?? node.c1;
      const r2 = to?.row ?? node.r2;
      const c2 = to?.col ?? node.c2;
      return {
        ...node,
        r1: Math.min(r1, r2),
        c1: Math.min(c1, c2),
        r2: Math.max(r1, r2),
        c2: Math.max(c1, c2),
      };
    }
    case "neg":
    case "pct":
      return { ...node, x: mapReferences(node.x, map) };
    case "bin":
      return { ...node, a: mapReferences(node.a, map), b: mapReferences(node.b, map) };
    case "call":
      return { ...node, args: node.args.map((arg) => mapReferences(arg, map)) };
    default:
      return node;
  }
}

/**
 * Формула при копировании в другую клетку: относительные ссылки едут на ту же
 * дельту, ссылки с долларом стоят. Ушедшая за край становится `#REF!`.
 */
export function offsetFormula(formula: string, dRow: number, dCol: number): string {
  let node: FormulaNode;
  try {
    node = parseFormula(formula);
  } catch {
    return formula;
  }
  const moved = mapReferences(node, ({ row, col, rowAbs, colAbs }) => {
    const nextRow = rowAbs ? row : row + dRow;
    const nextCol = colAbs ? col : col + dCol;
    if (nextRow < 0 || nextCol < 0) return null;
    return { row: nextRow, col: nextCol };
  });
  return formulaToText(moved);
}

/**
 * Все ссылки формулы — нужны движку, чтобы построить порядок пересчёта, и
 * редактору, чтобы подсветить используемые диапазоны.
 */
export function collectReferences(
  node: FormulaNode,
): Array<{ sheet: string | null; r1: number; c1: number; r2: number; c2: number }> {
  const out: Array<{ sheet: string | null; r1: number; c1: number; r2: number; c2: number }> = [];
  const walk = (n: FormulaNode) => {
    switch (n.k) {
      case "ref":
        out.push({ sheet: n.sheet, r1: n.row, c1: n.col, r2: n.row, c2: n.col });
        break;
      case "range":
        out.push({ sheet: n.sheet, r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 });
        break;
      case "neg":
      case "pct":
        walk(n.x);
        break;
      case "bin":
        walk(n.a);
        walk(n.b);
        break;
      case "call":
        for (const arg of n.args) walk(arg);
        break;
      default:
        break;
    }
  };
  walk(node);
  return out;
}
