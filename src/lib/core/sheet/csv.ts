// CSV: разбор и сборка.
//
// Своими руками, а не библиотекой, потому что вся сложность здесь не в
// синтаксисе (он умещается в конечный автомат на тридцать строк), а в том, что
// присылают люди: точка с запятой вместо запятой, запятая как десятичный
// разделитель, Windows-1251 вместо UTF-8, BOM в начале. Библиотека разбирает
// первое и не помогает с остальным.

import { parseInput } from "./format";
import {
  emptySheet,
  setCell,
  SHEET_LIMITS,
  usedBounds,
  type SheetCell,
  type SheetTab,
  type Workbook,
} from "./model";
import { styleIndex } from "./ops";

/** Разделители-кандидаты в порядке проверки. */
const DELIMITERS = [";", ",", "\t", "|"] as const;

/**
 * Угадать разделитель по первым строкам: побеждает тот, что даёт одинаковое и
 * наибольшее число колонок. Русский Excel пишет «;», англоязычные выгрузки —
 * «,», и ошибиться здесь значит показать таблицу одной колонкой.
 */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).filter(Boolean);
  if (!sample.length) return ",";

  let best = ",";
  let bestScore = -1;
  for (const delimiter of DELIMITERS) {
    const counts = sample.map((line) => splitLine(line, delimiter).length);
    const columns = Math.max(...counts);
    if (columns < 2) continue;
    const consistent = counts.filter((count) => count === columns).length / counts.length;
    const score = consistent * 10 + columns / 100;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

/** Грубое деление строки — только для угадывания разделителя (кавычки учтены). */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** CSV → таблица строк. Кавычки, переносы внутри полей и `""` — по RFC 4180. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const source = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }

    if (ch === '"' && field === "") {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  // Хвостовая пустая строка — артефакт перевода строки в конце файла.
  while (rows.length && rows[rows.length - 1].every((cell) => cell === "")) rows.pop();
  return rows;
}

/**
 * Таблица строк → книга. Первая строка выделяется жирным: в девяти случаях из
 * десяти это шапка, а отличить её наверняка нельзя — зато снять начертание
 * человеку проще, чем догадаться его поставить.
 */
export function rowsToWorkbook(rows: string[][], sheetName = "Лист 1"): Workbook {
  const workbook: Workbook = { v: 1, sheets: [], styles: [] };
  const sheet = emptySheet(sheetName);
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  sheet.rows = Math.min(SHEET_LIMITS.rows, Math.max(rows.length + 20, 50));
  sheet.cols = Math.min(SHEET_LIMITS.cols, Math.max(width + 3, 10));
  workbook.sheets.push(sheet);

  const header = styleIndex(workbook, { b: 1 });
  let budget = SHEET_LIMITS.cells;

  rows.forEach((row, rowIndex) => {
    if (rowIndex >= sheet.rows) return;
    row.forEach((raw, colIndex) => {
      if (colIndex >= sheet.cols || budget <= 0) return;
      const trimmed = raw.trim();
      if (!trimmed && rowIndex > 0) return;
      const parsed = parseInput(trimmed);
      const cell: SheetCell = {};
      if (parsed.formula) cell.f = parsed.formula;
      else cell.v = parsed.value;
      if (rowIndex === 0 && header !== undefined) cell.s = header;
      else if (parsed.fmt) {
        const index = styleIndex(workbook, { fmt: parsed.fmt });
        if (index !== undefined) cell.s = index;
      }
      setCell(sheet, rowIndex, colIndex, cell);
      budget--;
    });
  });

  if (rows.length) sheet.frozen = { rows: 1, cols: 0 };
  return workbook;
}

export function csvToWorkbook(text: string, sheetName = "Лист 1"): Workbook {
  return rowsToWorkbook(parseCsv(text), sheetName);
}

/**
 * Что из файла не поместилось в лист. Считается по тем же правилам, что и
 * раскладка в `rowsToWorkbook`, — молча обрезать csv нельзя ровно так же, как
 * xlsx.
 */
export function csvOverflow(rows: string[][]): string[] {
  const notes: string[] = [];
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (rows.length > SHEET_LIMITS.rows) {
    notes.push(
      `Перенесены первые ${SHEET_LIMITS.rows} строк, ещё ${rows.length - SHEET_LIMITS.rows} осталось в файле`,
    );
  }
  if (width > SHEET_LIMITS.cols) {
    notes.push(
      `Перенесены первые ${SHEET_LIMITS.cols} колонок, ещё ${width - SHEET_LIMITS.cols} осталось в файле`,
    );
  }
  return notes;
}

/**
 * Лист → CSV. Разделитель — точка с запятой, кодировка — UTF-8 с BOM: так файл
 * открывается двойным щелчком в русском Excel, а не превращается в одну колонку
 * с «Ð¿Ñ€Ð¸Ð²ÐµÑ‚» вместо текста.
 */
export function sheetToCsv(
  sheet: SheetTab,
  displayed: (row: number, col: number) => string,
  delimiter = ";",
): string {
  const bounds = usedBounds(sheet);
  if (!bounds) return "";
  const lines: string[] = [];
  for (let row = 0; row <= bounds.row; row++) {
    const cells: string[] = [];
    for (let col = 0; col <= bounds.col; col++) cells.push(escapeCsv(displayed(row, col), delimiter));
    lines.push(cells.join(delimiter));
  }
  return `﻿${lines.join("\r\n")}`;
}

function escapeCsv(value: string, delimiter: string): string {
  if (value === "") return "";
  const needsQuotes = value.includes(delimiter) || /["\n\r]/.test(value);
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Буфер обмена. Excel и Google Sheets кладут в него таблицу, разделённую
 * табуляцией, — на неё и опираемся: копирование между нашей таблицей и чужой
 * должно работать без промежуточного файла.
 */
export function parseClipboard(text: string): string[][] {
  const hasTabs = text.includes("\t");
  return parseCsv(text, hasTabs ? "\t" : detectDelimiter(text));
}

export function toClipboard(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => (/[\t\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join("\t"))
    .join("\n");
}
