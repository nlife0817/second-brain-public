// Чтение и запись .xlsx — единственное место, где мы имеем дело с форматом
// Office Open XML.
//
// Только сервер: exceljs весит около мегабайта и тянет `stream`/`zlib`, в
// браузерный бандл ему нельзя. Разбор идёт в роуте импорта, сборка — в роуте
// выгрузки, а страница получает и отдаёт уже нашу книгу.
//
// Переносим смысл, а не начертание. Шрифты, условное форматирование, картинки,
// сводные таблицы и диаграммы остаются в исходном файле — он и хранится
// вложением рядом с таблицей. Переносится то, без чего таблица перестаёт быть
// собой: значения, формулы, числовые форматы, начертание и цвет, выключка,
// границы, ширины, объединения и закреплённые области.
//
// Границы едут цветом, без толщины и пунктира: в модели их четыре стороны, а
// толстая линия от тонкой отличается ровно в той смете, которую всё равно можно
// открыть исходником.

import ExcelJS from "exceljs";
import { FORMATS, isDateFormat, normalizeNumFmt, toExcelNumFmt } from "./format";
import { dateToSerial, serialToDate } from "./functions";
import { offsetFormula } from "./formula";
import {
  cellRef,
  parseRange,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  emptySheet,
  normalizeWorkbook,
  parseRef,
  SHEET_LIMITS,
  type CellStyle,
  type SheetCell,
  type SheetTab,
  type Workbook,
} from "./model";
import { DEFAULT_BORDER_COLOR, styleIndex } from "./ops";

/** Что не поместилось при импорте — показываем человеку списком. */
export interface ImportNotes {
  workbook: Workbook;
  notes: string[];
}

// --- Чтение ----------------------------------------------------------------

export async function workbookFromXlsx(bytes: Uint8Array): Promise<ImportNotes> {
  const source = new ExcelJS.Workbook();
  // Buffer, а не ArrayBuffer: exceljs ждёт именно его, иначе падает в unzip.
  await source.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);

  const notes: string[] = [];
  const target: Workbook = { v: 1, sheets: [], styles: [] };
  let budget = SHEET_LIMITS.cells;

  const sheets = source.worksheets.slice(0, SHEET_LIMITS.sheets);
  if (source.worksheets.length > sheets.length) {
    notes.push(`Листов в файле ${source.worksheets.length}, перенесено ${sheets.length}`);
  }

  for (const ws of sheets) {
    const sheet = emptySheet(ws.name || "Лист");
    const used = readSheet(ws, sheet, target, budget);
    budget -= used.cells;
    if (used.truncated) {
      notes.push(`Лист «${sheet.name}»: перенесена только часть данных — файл слишком велик`);
    }
    // Молча обрезать нельзя: человек обязан знать, чего в таблице не будет.
    if (used.droppedRows) {
      notes.push(
        `Лист «${sheet.name}»: перенесены первые ${SHEET_LIMITS.rows} строк, ещё ${used.droppedRows} осталось в файле`,
      );
    }
    if (used.droppedCols) {
      notes.push(
        `Лист «${sheet.name}»: перенесены первые ${SHEET_LIMITS.cols} колонок, ещё ${used.droppedCols} осталось в файле`,
      );
    }
    if (used.droppedFormulas) {
      notes.push(
        `Лист «${sheet.name}»: ${used.droppedFormulas} формул сохранены значениями — их синтаксис не поддерживается`,
      );
    }
    target.sheets.push(sheet);
    if (budget <= 0) {
      notes.push("Достигнут предел размера таблицы, остальное не перенесено");
      break;
    }
  }

  if (!target.sheets.length) target.sheets.push(emptySheet("Лист 1"));
  return { workbook: normalizeWorkbook(target), notes };
}

interface SheetUsage {
  cells: number;
  truncated: boolean;
  droppedFormulas: number;
  /** Строк и колонок, не поместившихся в лист: о них обязаны сказать вслух. */
  droppedRows: number;
  droppedCols: number;
}

function readSheet(
  ws: ExcelJS.Worksheet,
  sheet: SheetTab,
  workbook: Workbook,
  budget: number,
): SheetUsage {
  const usage: SheetUsage = {
    cells: 0,
    truncated: false,
    droppedFormulas: 0,
    droppedRows: 0,
    droppedCols: 0,
  };

  // Размер листа: то, что реально занято, плюс запас на дописывание.
  sheet.rows = clamp(ws.actualRowCount || ws.rowCount || 0, SHEET_LIMITS.rows, 50, 30);
  sheet.cols = clamp(ws.actualColumnCount || ws.columnCount || 0, SHEET_LIMITS.cols, 12, 4);

  // Мастера общих формул: у ведомых ячеек хранится только адрес мастера, и
  // формула для них выводится сдвигом — тем же, что при копировании.
  const masters = new Map<string, string>();

  // Объединения читаем ДО ячеек: exceljs отдаёт значение объединённой области
  // в каждой её ячейке, а у нас живёт только левая верхняя (см. `mergeRange`).
  // Без этого отмена объединения показывала бы четыре копии одного текста, и
  // ровно столько же уезжало бы в csv.
  const merges = (ws.model as { merges?: string[] })?.merges ?? [];
  const covered = new Set<string>();
  for (const item of merges.slice(0, 500)) {
    const area = parseRange(item);
    if (!area) continue;
    for (let row = area.r1; row <= area.r2; row++) {
      for (let col = area.c1; col <= area.c2; col++) {
        if (row === area.r1 && col === area.c1) continue;
        covered.add(cellRef(row, col));
      }
    }
  }

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber > sheet.rows) {
      usage.droppedRows++;
      return;
    }
    if (usage.truncated) return;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (colNumber > sheet.cols) {
        usage.droppedCols = Math.max(usage.droppedCols, colNumber - sheet.cols);
        return;
      }
      if (covered.has(cellRef(rowNumber - 1, colNumber - 1))) return;
      if (usage.cells >= budget) {
        usage.truncated = true;
        return;
      }
      const parsed = readCell(cell, masters, usage);
      const style = readStyle(cell, parsed.dateLike);
      const index = styleIndex(workbook, style);
      if (index !== undefined) parsed.cell.s = index;
      if (parsed.cell.v === undefined && !parsed.cell.f && parsed.cell.s === undefined) return;
      sheet.cells[cellRef(rowNumber - 1, colNumber - 1)] = parsed.cell;
      usage.cells++;
    });

    if (row.height && Math.abs(row.height * (4 / 3) - DEFAULT_ROW_HEIGHT) > 2) {
      sheet.heights = sheet.heights ?? {};
      sheet.heights[String(rowNumber - 1)] = Math.round(row.height * (4 / 3));
    }
  });

  // Скрытые строки читаем отдельным проходом С ПУСТЫМИ: прячут как раз пустые
  // служебные строки, а обход по значениям их не видит вовсе.
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber > sheet.rows || !row.hidden) return;
    sheet.hiddenR = sheet.hiddenR ?? [];
    sheet.hiddenR.push(rowNumber - 1);
  });

  ws.columns?.forEach((column, index) => {
    if (index >= sheet.cols) return;
    if (column?.hidden) {
      sheet.hiddenC = sheet.hiddenC ?? [];
      sheet.hiddenC.push(index);
    }
    if (!column?.width) return;
    // Ширина в xlsx — в «символах» шрифта по умолчанию; в пикселях это примерно
    // 7 пикселей на символ плюс поля ячейки.
    const px = Math.round(column.width * 7 + 5);
    if (Math.abs(px - DEFAULT_COL_WIDTH) > 4) {
      sheet.widths = sheet.widths ?? {};
      sheet.widths[String(index)] = px;
    }
  });

  if (merges.length) sheet.merges = merges.slice(0, 500);

  const view = ws.views?.[0];
  if (view?.state === "frozen") {
    const rows = Math.max(0, Math.min(20, view.ySplit ?? 0));
    const cols = Math.max(0, Math.min(20, view.xSplit ?? 0));
    if (rows || cols) sheet.frozen = { rows, cols };
  }

  return usage;
}

function clamp(value: number, max: number, min: number, slack: number): number {
  return Math.min(max, Math.max(min, value + slack));
}

interface ReadCell {
  cell: SheetCell;
  /** Значение приехало датой — формат обязан это показать. */
  dateLike: boolean;
}

function readCell(
  cell: ExcelJS.Cell,
  masters: Map<string, string>,
  usage: SheetUsage,
): ReadCell {
  const out: SheetCell = {};
  const dateLike = false;
  const raw = cell.value as unknown;

  if (raw === null || raw === undefined) return { cell: out, dateLike };

  if (typeof raw === "object" && raw !== null) {
    const object = raw as Record<string, unknown>;

    if (typeof object.formula === "string") {
      out.f = object.formula.replace(/^=/, "");
      masters.set(cell.address, out.f);
      out.v = resultValue(object.result);
      return { cell: out, dateLike: object.result instanceof Date };
    }

    if (typeof object.sharedFormula === "string") {
      const master = masters.get(object.sharedFormula);
      const from = parseRef(object.sharedFormula);
      const to = parseRef(cell.address);
      if (master && from && to) {
        out.f = offsetFormula(master, to.row - from.row, to.col - from.col);
      } else {
        // Мастера не встретили (бывает при нестандартном порядке в файле) —
        // оставляем посчитанное значение: показать число вернее, чем ничего.
        usage.droppedFormulas++;
      }
      out.v = resultValue(object.result);
      return { cell: out, dateLike: object.result instanceof Date };
    }

    if (Array.isArray(object.richText)) {
      out.v = (object.richText as Array<{ text?: string }>)
        .map((part) => part.text ?? "")
        .join("")
        .slice(0, SHEET_LIMITS.text);
      return { cell: out, dateLike };
    }

    if (typeof object.text === "string") {
      // Ссылка: текст видим, адрес теряем — своего типа «гиперссылка» у нас нет.
      out.v = object.text.slice(0, SHEET_LIMITS.text);
      return { cell: out, dateLike };
    }

    if (typeof object.error === "string") {
      out.v = object.error;
      return { cell: out, dateLike };
    }

    if (raw instanceof Date) {
      out.v = dateToSerial(raw);
      return { cell: out, dateLike: true };
    }

    return { cell: out, dateLike };
  }

  if (typeof raw === "number") out.v = raw;
  else if (typeof raw === "boolean") out.v = raw;
  else if (typeof raw === "string") out.v = raw.slice(0, SHEET_LIMITS.text);

  return { cell: out, dateLike };
}

function resultValue(result: unknown): SheetCell["v"] {
  if (result === null || result === undefined) return undefined;
  if (result instanceof Date) return dateToSerial(result);
  if (typeof result === "number" || typeof result === "string" || typeof result === "boolean") {
    return typeof result === "string" ? result.slice(0, SHEET_LIMITS.text) : result;
  }
  const error = (result as { error?: string }).error;
  return typeof error === "string" ? error : undefined;
}

function readStyle(cell: ExcelJS.Cell, dateLike: boolean): CellStyle {
  const style: CellStyle = {};
  const font = cell.font;
  if (font?.bold) style.b = 1;
  if (font?.italic) style.i = 1;
  if (font?.underline) style.u = 1;
  if (font?.strike) style.st = 1;

  const color = argbToHex(font?.color?.argb);
  // Чёрный текст — это не оформление, а умолчание: сохранять его значит
  // записать цвет каждой ячейке файла и раздуть таблицу стилей.
  if (color && color !== "#000000") style.c = color;

  const fill = cell.fill as { type?: string; pattern?: string; fgColor?: { argb?: string } } | undefined;
  if (fill?.type === "pattern" && fill.pattern === "solid") {
    const bg = argbToHex(fill.fgColor?.argb);
    if (bg && bg !== "#ffffff") style.bg = bg;
  }

  const alignment = cell.alignment;
  if (alignment?.horizontal === "left" || alignment?.horizontal === "center" || alignment?.horizontal === "right") {
    style.ha = alignment.horizontal;
  }
  if (alignment?.vertical === "top" || alignment?.vertical === "middle" || alignment?.vertical === "bottom") {
    style.va = alignment.vertical;
  }
  if (alignment?.wrapText) style.wrap = 1;

  const border = cell.border;
  if (border) {
    const sides = [
      ["bt", border.top],
      ["br", border.right],
      ["bb", border.bottom],
      ["bl", border.left],
    ] as const;
    for (const [side, edge] of sides) {
      if (!edge?.style) continue;
      // Цвет границы в файле часто не задан — Excel рисует такую чёрной.
      style[side] = argbToHex(edge.color?.argb) ?? DEFAULT_BORDER_COLOR;
    }
  }

  const fmt = normalizeNumFmt(cell.numFmt);
  if (fmt) style.fmt = fmt;
  // Дата без формата показалась бы числом в сорок пять тысяч.
  else if (dateLike) style.fmt = FORMATS.date;

  return style;
}

function argbToHex(argb: string | undefined): string | undefined {
  if (!argb || argb.length < 6) return undefined;
  const hex = argb.slice(-6).toLowerCase();
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : undefined;
}

// --- Запись ----------------------------------------------------------------

/**
 * Книга → .xlsx. Формулы уезжают формулами, даты — числами с датным форматом
 * (так их и хранит сам Excel), оформление — тем, что мы умеем показывать.
 */
export async function workbookToXlsx(workbook: Workbook, title: string): Promise<Buffer> {
  const out = new ExcelJS.Workbook();
  out.creator = "Second Brain";
  out.created = new Date();

  for (const sheet of workbook.sheets) {
    const ws = out.addWorksheet(sheet.name.slice(0, 31) || "Лист");

    for (const [ref, cell] of Object.entries(sheet.cells)) {
      const at = parseRef(ref);
      if (!at) continue;
      const target = ws.getCell(at.row + 1, at.col + 1);
      const style = cell.s === undefined ? undefined : workbook.styles[cell.s];

      if (cell.f) {
        // Разделитель аргументов в файле обязан быть запятой: точку с запятой
        // Excel читает по локали, и на английской раскладке формула сломается.
        target.value = { formula: cell.f.replace(/;/g, ","), result: asResult(cell.v) };
      } else if (cell.v !== undefined && cell.v !== null) {
        target.value = cell.v as ExcelJS.CellValue;
      }

      if (!style) continue;
      const numFmt = toExcelNumFmt(style.fmt);
      if (numFmt) target.numFmt = numFmt;
      if (style.b || style.i || style.u || style.st || style.c) {
        target.font = {
          bold: style.b === 1,
          italic: style.i === 1,
          underline: style.u === 1,
          strike: style.st === 1,
          color: style.c ? { argb: `FF${style.c.slice(1)}`.toUpperCase() } : undefined,
        };
      }
      if (style.bg) {
        target.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: `FF${style.bg.slice(1)}`.toUpperCase() },
        };
      }
      if (style.bt || style.br || style.bb || style.bl) {
        target.border = {
          top: excelBorder(style.bt),
          right: excelBorder(style.br),
          bottom: excelBorder(style.bb),
          left: excelBorder(style.bl),
        };
      }
      if (style.ha || style.va || style.wrap) {
        target.alignment = {
          horizontal: style.ha,
          vertical: style.va,
          wrapText: style.wrap === 1,
        };
      }
    }

    for (const [index, width] of Object.entries(sheet.widths ?? {})) {
      const column = ws.getColumn(Number(index) + 1);
      column.width = Math.max(2, (width - 5) / 7);
    }
    for (const [index, height] of Object.entries(sheet.heights ?? {})) {
      ws.getRow(Number(index) + 1).height = Math.max(6, height * 0.75);
    }
    for (const line of sheet.hiddenR ?? []) ws.getRow(line + 1).hidden = true;
    for (const line of sheet.hiddenC ?? []) ws.getColumn(line + 1).hidden = true;
    for (const merge of sheet.merges ?? []) {
      try {
        ws.mergeCells(merge);
      } catch {
        // Пересечение объединений — единственная причина отказа; наша модель
        // их не допускает, но чужая книга могла приехать любой.
      }
    }
    if (sheet.frozen) {
      ws.views = [
        {
          state: "frozen",
          xSplit: sheet.frozen.cols || undefined,
          ySplit: sheet.frozen.rows || undefined,
        },
      ];
    }
  }

  if (!out.worksheets.length) out.addWorksheet(title.slice(0, 31) || "Лист");
  const buffer = await out.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function excelBorder(color: string | undefined): Partial<ExcelJS.Border> | undefined {
  if (!color) return undefined;
  return { style: "thin", color: { argb: `FF${color.slice(1)}`.toUpperCase() } };
}

function asResult(value: SheetCell["v"]): number | string | boolean | undefined {
  if (value === null || value === undefined) return undefined;
  return value;
}

/**
 * Текст ячейки для выгрузки в csv. Числа уходят с запятой в дробной части и без
 * разделителя разрядов: это данные, а не показ, и Excel обязан прочитать их
 * числом обратно.
 */
export function csvCellText(cell: SheetCell | undefined, style: CellStyle | undefined): string {
  if (!cell) return "";
  const value = cell.v;
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "ИСТИНА" : "ЛОЖЬ";
  if (typeof value === "string") return value;
  if (isDateFormat(style?.fmt)) {
    const date = serialToDate(value);
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}.${mm}.${date.getUTCFullYear()}`;
  }
  return String(value).replace(".", ",");
}
