// Модель электронной таблицы: типы книги, адресация A1 и приведение к
// каноническому виду.
//
// Книга целиком лежит JSON'ом в `core.kb_documents.body` — там же, где у
// обычного документа лежит HTML, и отличает их `kind`. Отдельной таблицы под
// таблицы нет намеренно: дерево, доступ, корзина, история версий, привязка к
// задачам и папки уже написаны вокруг узла базы знаний, и вторая копия этих
// правил разошлась бы с первой на первой же правке.
//
// Отсюда же следует форма JSON: он хранится и версионируется как текст, а
// автосохранение шлёт его целиком. Поэтому ключи короткие, ячейки лежат
// разреженной картой (пустая клетка не занимает ничего), а оформление вынесено
// в общую на книгу таблицу стилей — одинаково оформленная колонка ссылается на
// одну строку, а не повторяет её тысячу раз.

/** Значение ячейки в том виде, в каком оно хранится и считается. */
export type CellValue = string | number | boolean | null;

/**
 * Ячейка. Формула и значение живут вместе: `f` — источник истины, `v` — её
 * последний посчитанный результат. Кэш нужен, чтобы страница показывала числа
 * до того, как отработает пересчёт, и чтобы выгрузка в csv не тянула движок.
 */
export interface SheetCell {
  /** Значение. У формульной ячейки — последний результат вычисления. */
  v?: CellValue;
  /** Формула без ведущего «=». Пусто — значение введено руками. */
  f?: string;
  /** Индекс в `Workbook.styles`. Пусто — оформления нет. */
  s?: number;
}

/** Оформление ячейки. Каждое поле необязательно: пустой стиль — это `{}`. */
export interface CellStyle {
  /** Жирный, курсив, подчёркнутый, зачёркнутый — 1 вместо true ради размера. */
  b?: 1;
  i?: 1;
  u?: 1;
  st?: 1;
  /** Цвет текста и заливка, `#rrggbb`. */
  c?: string;
  bg?: string;
  ha?: "left" | "center" | "right";
  va?: "top" | "middle" | "bottom";
  /** Код числового формата — см. format.ts. */
  fmt?: string;
  wrap?: 1;
}

/** Замороженная область: сколько строк сверху и колонок слева не уезжают. */
export interface FrozenPanes {
  rows: number;
  cols: number;
}

/** Сортировка диапазона, зафиксированная на листе: её видно в шапке колонки. */
export interface SheetSort {
  /** Индекс колонки, по которой отсортировано. */
  col: number;
  dir: "asc" | "desc";
}

/**
 * Фильтр колонки. Держим два независимых условия — список разрешённых значений
 * (как «галочки» в Excel) и текстовый поиск. Пустой список значит «все».
 */
export interface ColumnFilter {
  col: number;
  /** Разрешённые значения в строковом виде. `null` — фильтра по списку нет. */
  values?: string[] | null;
  /** Подстрока; сравнение без учёта регистра. */
  contains?: string;
}

export interface SheetTab {
  id: string;
  name: string;
  /** Логический размер листа: сетка рисуется по нему, данные могут быть реже. */
  rows: number;
  cols: number;
  /** Ячейки по адресу A1. Разреженная карта: пустых ключей здесь нет. */
  cells: Record<string, SheetCell>;
  /** Ширина колонки в пикселях по её индексу (строкой — так короче в JSON). */
  widths?: Record<string, number>;
  /** Высота строки в пикселях по её индексу. */
  heights?: Record<string, number>;
  /** Объединённые области в виде «A1:B2». */
  merges?: string[];
  frozen?: FrozenPanes;
  sort?: SheetSort | null;
  filters?: ColumnFilter[];
}

export interface Workbook {
  /** Версия формата. Меняется, только если старые книги придётся читать иначе. */
  v: 1;
  sheets: SheetTab[];
  /** Общая таблица оформления; ячейка ссылается сюда индексом. */
  styles: CellStyle[];
}

// --- Пределы ---------------------------------------------------------------
//
// Книга едет в браузер и обратно целиком на каждом автосохранении и попадает в
// каждую строку истории версий. Поэтому пределы жёсткие и проверяются и на
// импорте, и на сохранении: без них один выгруженный из 1С отчёт на полмиллиона
// строк кладёт и страницу, и ежедневный дамп базы.

export const SHEET_LIMITS = {
  /** Листов в книге. */
  sheets: 20,
  /** Строк и колонок на листе — потолок сетки, а не числа заполненных. */
  rows: 5000,
  cols: 100,
  /** Непустых ячеек во всей книге. */
  cells: 50_000,
  /** Длина текста в одной ячейке. */
  text: 4000,
  /** Размер книги в сериализованном виде. */
  bytes: 4 * 1024 * 1024,
} as const;

/** Сколько строк и колонок у пустого листа: экран, а не бесконечность. */
const DEFAULT_ROWS = 100;
const DEFAULT_COLS = 26;

export const DEFAULT_COL_WIDTH = 104;
export const DEFAULT_ROW_HEIGHT = 28;

// --- Адресация A1 ----------------------------------------------------------

/** Номер колонки (0-based) → буквы: 0 → A, 25 → Z, 26 → AA. */
export function columnName(col: number): string {
  let out = "";
  let n = col;
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

/** Буквы колонки → индекс. Регистр не важен: `a1` и `A1` — одна ячейка. */
export function columnIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Адрес ячейки: (0,0) → «A1». */
export function cellRef(row: number, col: number): string {
  return `${columnName(col)}${row + 1}`;
}

const REF_RE = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;

/** Разбор «A1» / «$A$1». `null` — не адрес. */
export function parseRef(ref: string): { row: number; col: number } | null {
  const m = REF_RE.exec(ref.trim());
  if (!m) return null;
  const row = Number(m[2]) - 1;
  if (row < 0) return null;
  return { row, col: columnIndex(m[1]) };
}

/** Прямоугольник в координатах листа; границы включительные. */
export interface CellRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** Разбор «A1:B2» (и одиночного «A1» как области 1×1). */
export function parseRange(text: string): CellRange | null {
  const [a, b] = text.split(":");
  const from = parseRef(a ?? "");
  if (!from) return null;
  if (b === undefined) return { r1: from.row, c1: from.col, r2: from.row, c2: from.col };
  const to = parseRef(b);
  if (!to) return null;
  return normalizeRange({ r1: from.row, c1: from.col, r2: to.row, c2: to.col });
}

/** Область в виде «A1:B2». Одиночную клетку записываем как «A1:A1» ради простоты сравнения. */
export function rangeRef(range: CellRange): string {
  return `${cellRef(range.r1, range.c1)}:${cellRef(range.r2, range.c2)}`;
}

/** Левый верхний угол всегда левее и выше правого нижнего. */
export function normalizeRange(range: CellRange): CellRange {
  return {
    r1: Math.min(range.r1, range.r2),
    c1: Math.min(range.c1, range.c2),
    r2: Math.max(range.r1, range.r2),
    c2: Math.max(range.c1, range.c2),
  };
}

export function rangeContains(range: CellRange, row: number, col: number): boolean {
  return row >= range.r1 && row <= range.r2 && col >= range.c1 && col <= range.c2;
}

/** Перебор адресов области построчно. */
export function* rangeCells(range: CellRange): Generator<{ row: number; col: number }> {
  for (let row = range.r1; row <= range.r2; row++) {
    for (let col = range.c1; col <= range.c2; col++) yield { row, col };
  }
}

// --- Чтение и запись ячеек -------------------------------------------------

export function getCell(sheet: SheetTab, row: number, col: number): SheetCell | undefined {
  return sheet.cells[cellRef(row, col)];
}

/**
 * Запись ячейки. Пустая ячейка удаляется из карты, а не остаётся пустым
 * объектом: разреженность — это и вес JSON, и скорость обхода при пересчёте.
 */
export function setCell(sheet: SheetTab, row: number, col: number, cell: SheetCell | null): void {
  const ref = cellRef(row, col);
  if (!cell || isBlankCell(cell)) delete sheet.cells[ref];
  else sheet.cells[ref] = cell;
}

export function isBlankCell(cell: SheetCell): boolean {
  const empty = cell.v === undefined || cell.v === null || cell.v === "";
  return empty && !cell.f && cell.s === undefined;
}

/** Пустая книга: один лист, экран строк и колонок. */
export function emptyWorkbook(name = "Лист 1"): Workbook {
  return { v: 1, sheets: [emptySheet(name)], styles: [] };
}

export function emptySheet(name: string, id = randomId()): SheetTab {
  return { id, name, rows: DEFAULT_ROWS, cols: DEFAULT_COLS, cells: {} };
}

/**
 * Идентификатор листа. `crypto.randomUUID` есть и в браузере, и в Node 20+,
 * но книга собирается ещё и в тестах — запасной путь оставляем.
 */
export function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

// --- Приведение к каноническому виду ---------------------------------------

/**
 * Что угодно, приехавшее снаружи, → корректная книга.
 *
 * Валидация здесь, а не в zod, потому что задача не «отвергнуть», а «принять
 * как можно больше»: книга приходит и от нашего редактора, и из разбора чужого
 * xlsx, и из старой вкладки. Ошибка формы не должна превращаться в 400 на
 * автосохранении — лишнее отбрасывается, недостающее достраивается.
 *
 * Заодно это единственное место, где держатся пределы: всё, что не влезло,
 * обрезается ровно один раз, а не в каждом вызывающем.
 */
export function normalizeWorkbook(input: unknown): Workbook {
  const raw = asRecord(input);
  const sheetsRaw = Array.isArray(raw?.sheets) ? raw.sheets : [];
  const styles = normalizeStyles(raw?.styles);

  // Индексы стилей после чистки могут разъехаться — собираем карту переноса.
  const used = new Map<number, number>();
  const outStyles: CellStyle[] = [];
  const remap = (index: unknown): number | undefined => {
    if (typeof index !== "number" || !Number.isInteger(index)) return undefined;
    const style = styles[index];
    if (!style) return undefined;
    const known = used.get(index);
    if (known !== undefined) return known;
    const next = outStyles.push(style) - 1;
    used.set(index, next);
    return next;
  };

  let budget = SHEET_LIMITS.cells;
  const sheets: SheetTab[] = [];
  for (const item of sheetsRaw.slice(0, SHEET_LIMITS.sheets)) {
    const sheet = normalizeSheet(item, remap, budget);
    budget -= Object.keys(sheet.cells).length;
    sheets.push(sheet);
  }
  if (sheets.length === 0) sheets.push(emptySheet("Лист 1"));

  // Имена листов обязаны различаться: формула ссылается на лист по имени, и
  // два «Лист 1» сделали бы ссылку неразрешимой.
  const seen = new Set<string>();
  for (const sheet of sheets) {
    let name = sheet.name;
    let n = 2;
    while (seen.has(name.toLowerCase())) name = `${sheet.name} (${n++})`;
    sheet.name = name;
    seen.add(name.toLowerCase());
  }

  return { v: 1, sheets, styles: outStyles };
}

function normalizeSheet(
  input: unknown,
  remapStyle: (index: unknown) => number | undefined,
  cellBudget: number,
): SheetTab {
  const raw = asRecord(input) ?? {};
  const name = cleanSheetName(raw.name);
  const sheet: SheetTab = {
    id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 32) : randomId(),
    name,
    rows: clampInt(raw.rows, 1, SHEET_LIMITS.rows, DEFAULT_ROWS),
    cols: clampInt(raw.cols, 1, SHEET_LIMITS.cols, DEFAULT_COLS),
    cells: {},
  };

  const cells = asRecord(raw.cells) ?? {};
  let budget = Math.max(0, cellBudget);
  // Порядок обхода задаём адресом: при упоре в лимит должно отрезаться
  // предсказуемое «всё, что ниже и правее», а не случайные ячейки.
  for (const ref of Object.keys(cells).sort(compareRefs)) {
    if (budget <= 0) break;
    const at = parseRef(ref);
    if (!at) continue;
    if (at.row >= sheet.rows || at.col >= sheet.cols) continue;
    const cell = normalizeCell(cells[ref], remapStyle);
    if (!cell) continue;
    sheet.cells[cellRef(at.row, at.col)] = cell;
    budget--;
  }

  const widths = normalizeSizes(raw.widths, sheet.cols, 24, 640);
  if (widths) sheet.widths = widths;
  const heights = normalizeSizes(raw.heights, sheet.rows, 18, 400);
  if (heights) sheet.heights = heights;

  const merges = normalizeMerges(raw.merges, sheet);
  if (merges.length) sheet.merges = merges;

  const frozen = asRecord(raw.frozen);
  if (frozen) {
    const rows = clampInt(frozen.rows, 0, Math.min(sheet.rows, 20), 0);
    const cols = clampInt(frozen.cols, 0, Math.min(sheet.cols, 20), 0);
    if (rows || cols) sheet.frozen = { rows, cols };
  }

  const sort = asRecord(raw.sort);
  if (sort) {
    const col = clampInt(sort.col, 0, sheet.cols - 1, -1);
    if (col >= 0) sheet.sort = { col, dir: sort.dir === "desc" ? "desc" : "asc" };
  }

  const filters = Array.isArray(raw.filters) ? raw.filters : [];
  const clean: ColumnFilter[] = [];
  for (const item of filters.slice(0, SHEET_LIMITS.cols)) {
    const f = asRecord(item);
    if (!f) continue;
    const col = clampInt(f.col, 0, sheet.cols - 1, -1);
    if (col < 0) continue;
    const values = Array.isArray(f.values)
      ? f.values.filter((v): v is string => typeof v === "string").slice(0, 1000)
      : null;
    const contains = typeof f.contains === "string" ? f.contains.slice(0, 200) : "";
    if (!values && !contains) continue;
    clean.push({ col, values, contains });
  }
  if (clean.length) sheet.filters = clean;

  return sheet;
}

function normalizeCell(
  input: unknown,
  remapStyle: (index: unknown) => number | undefined,
): SheetCell | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const cell: SheetCell = {};

  if (typeof raw.f === "string" && raw.f.trim()) {
    cell.f = raw.f.trim().replace(/^=/, "").slice(0, SHEET_LIMITS.text);
  }

  const v = raw.v;
  if (typeof v === "string") cell.v = v.slice(0, SHEET_LIMITS.text);
  else if (typeof v === "number") cell.v = Number.isFinite(v) ? v : null;
  else if (typeof v === "boolean") cell.v = v;
  else if (v === null) cell.v = null;

  const style = remapStyle(raw.s);
  if (style !== undefined) cell.s = style;

  return isBlankCell(cell) ? null : cell;
}

function normalizeStyles(input: unknown): CellStyle[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 2000).map((item) => {
    const raw = asRecord(item) ?? {};
    const style: CellStyle = {};
    if (raw.b) style.b = 1;
    if (raw.i) style.i = 1;
    if (raw.u) style.u = 1;
    if (raw.st) style.st = 1;
    const c = hexColor(raw.c);
    if (c) style.c = c;
    const bg = hexColor(raw.bg);
    if (bg) style.bg = bg;
    if (raw.ha === "left" || raw.ha === "center" || raw.ha === "right") style.ha = raw.ha;
    if (raw.va === "top" || raw.va === "middle" || raw.va === "bottom") style.va = raw.va;
    if (typeof raw.fmt === "string" && raw.fmt.trim()) style.fmt = raw.fmt.trim().slice(0, 64);
    if (raw.wrap) style.wrap = 1;
    return style;
  });
}

function normalizeSizes(
  input: unknown,
  count: number,
  min: number,
  max: number,
): Record<string, number> | undefined {
  const raw = asRecord(input);
  if (!raw) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    out[String(index)] = Math.round(Math.min(max, Math.max(min, value)));
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Объединения приводим к «A1:B2» и разводим пересечения: две наложенные области
 * рисуются друг поверх друга, и какая победит — зависело бы от порядка обхода.
 */
function normalizeMerges(input: unknown, sheet: SheetTab): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const taken = new Set<string>();
  for (const item of input.slice(0, 500)) {
    if (typeof item !== "string") continue;
    const range = parseRange(item);
    if (!range) continue;
    if (range.r2 >= sheet.rows || range.c2 >= sheet.cols) continue;
    if (range.r1 === range.r2 && range.c1 === range.c2) continue;
    let overlaps = false;
    for (const { row, col } of rangeCells(range)) {
      if (taken.has(cellRef(row, col))) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    for (const { row, col } of rangeCells(range)) taken.add(cellRef(row, col));
    out.push(rangeRef(range));
  }
  return out;
}

/** Сортировка адресов «как в таблице»: сверху вниз, слева направо. */
export function compareRefs(a: string, b: string): number {
  const pa = parseRef(a);
  const pb = parseRef(b);
  if (!pa || !pb) return a.localeCompare(b);
  return pa.row - pb.row || pa.col - pb.col;
}

function cleanSheetName(input: unknown): string {
  const name = typeof input === "string" ? input.replace(/[\r\n\t]/g, " ").trim() : "";
  // Апостроф и восклицательный знак ломают ссылку вида 'Лист 1'!A1 — убираем их
  // здесь, а не при разборе формулы: имя листа человек видит и правит.
  return (name.replace(/['![\]:*?/\\]/g, "").trim() || "Лист").slice(0, 60);
}

function clampInt(input: unknown, min: number, max: number, fallback: number): number {
  if (typeof input !== "number" || !Number.isFinite(input)) return fallback;
  return Math.min(max, Math.max(min, Math.round(input)));
}

function hexColor(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(value) ? value : undefined;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

// --- Сериализация ----------------------------------------------------------

/** Книга → строка для колонки `body`. */
export function serializeWorkbook(workbook: Workbook): string {
  return JSON.stringify(workbook);
}

/**
 * Строка из колонки `body` → книга. Битое или пустое тело даёт пустую книгу:
 * страница обязана открыться в любом случае, иначе документ становится
 * недоступен навсегда — даже чтобы откатить его к прошлой версии.
 */
export function parseWorkbook(body: string): Workbook {
  if (!body.trim()) return emptyWorkbook();
  try {
    return normalizeWorkbook(JSON.parse(body));
  } catch {
    return emptyWorkbook();
  }
}

/** Есть ли в книге хоть что-то, кроме пустого первого листа. */
export function isEmptyWorkbook(workbook: Workbook): boolean {
  if (workbook.sheets.length !== 1) return false;
  return Object.keys(workbook.sheets[0].cells).length === 0;
}

/** Непустых ячеек во всей книге — для проверки пределов на импорте. */
export function countCells(workbook: Workbook): number {
  return workbook.sheets.reduce((sum, sheet) => sum + Object.keys(sheet.cells).length, 0);
}
