import { describe, expect, it } from "vitest";
import { csvToWorkbook, detectDelimiter, parseCsv, sheetToCsv } from "../sheet/csv";
import { recalculate } from "../sheet/engine";
import { FORMATS, formatValue, normalizeNumFmt, parseInput } from "../sheet/format";
import {
  cellRef,
  columnIndex,
  columnName,
  emptyWorkbook,
  normalizeWorkbook,
  parseWorkbook,
  serializeWorkbook,
  setCell,
  SHEET_LIMITS,
} from "../sheet/model";
import { applyStyle, deleteRows, insertRows, mergeRange, sortRange, styleIndex } from "../sheet/ops";

describe("адресация", () => {
  it("считает имена колонок за границей алфавита", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
    expect(columnName(701)).toBe("ZZ");
    expect(columnIndex("AA")).toBe(26);
    expect(cellRef(4, 2)).toBe("C5");
  });
});

describe("нормализация книги", () => {
  it("чинит битое тело, а не роняет страницу", () => {
    expect(parseWorkbook("не json").sheets).toHaveLength(1);
    expect(parseWorkbook("").sheets[0].cells).toEqual({});
  });

  it("разводит одинаковые имена листов", () => {
    const workbook = normalizeWorkbook({
      v: 1,
      sheets: [{ name: "Лист", cells: {} }, { name: "Лист", cells: {} }],
      styles: [],
    });
    expect(workbook.sheets.map((s) => s.name)).toEqual(["Лист", "Лист (2)"]);
  });

  it("держит потолок по числу ячеек", () => {
    const cells: Record<string, { v: number }> = {};
    for (let row = 1; row <= 1200; row++) {
      for (let col = 0; col < 60; col++) cells[`${columnName(col)}${row}`] = { v: 1 };
    }
    const workbook = normalizeWorkbook({
      v: 1,
      sheets: [{ name: "Л", rows: 5000, cols: 100, cells }],
      styles: [],
    });
    expect(Object.keys(workbook.sheets[0].cells).length).toBe(SHEET_LIMITS.cells);
    // Отрезается «хвост» снизу, а не случайные ячейки: первая строка на месте.
    expect(workbook.sheets[0].cells.A1).toBeDefined();
  });

  it("выбрасывает стили, на которые никто не ссылается", () => {
    const workbook = normalizeWorkbook({
      v: 1,
      sheets: [{ name: "Л", rows: 10, cols: 10, cells: { A1: { v: 1, s: 1 } } }],
      styles: [{ b: 1 }, { i: 1 }],
    });
    expect(workbook.styles).toEqual([{ i: 1 }]);
    expect(workbook.sheets[0].cells.A1.s).toBe(0);
  });

  it("байты клиента и сервера совпадают", () => {
    // На этом держится история отмен: страница сравнивает пришедшее с сервера
    // тело со своим, и любое расхождение читается как ЧУЖАЯ правка — книга
    // подменяется, стопка отмены обнуляется. Порядок ключей в JSON разный по
    // построению (редактор дописывает значение формулы после стиля), поэтому
    // сериализация обязана приводить обе стороны к одному виду.
    const workbook = emptyWorkbook("Смета");
    const style = styleIndex(workbook, { fmt: FORMATS.thousandsDecimal })!;
    setCell(workbook.sheets[0], 0, 0, { v: 2 });
    setCell(workbook.sheets[0], 1, 0, { f: "A1*2", s: style });
    recalculate(workbook);

    const client = serializeWorkbook(workbook);
    // Ровно то, что делает с телом сервер (`cleanBody` в kb.ts).
    const server = serializeWorkbook(normalizeWorkbook(JSON.parse(client)));
    expect(server).toBe(client);
  });

  it("книга переживает круг сериализации", () => {
    const workbook = emptyWorkbook("Смета");
    setCell(workbook.sheets[0], 0, 0, { v: 42, s: undefined });
    const restored = parseWorkbook(serializeWorkbook(workbook));
    expect(restored.sheets[0].name).toBe("Смета");
    expect(restored.sheets[0].cells.A1.v).toBe(42);
  });
});

describe("оформление больших выделений", () => {
  it("«выделить всё» не заводит сотни тысяч ячеек ради стиля", () => {
    const workbook = emptyWorkbook("Л");
    const sheet = workbook.sheets[0];
    sheet.rows = SHEET_LIMITS.rows;
    sheet.cols = SHEET_LIMITS.cols;
    for (let row = 0; row < 300; row++) setCell(sheet, row, 0, { v: row });

    const next = applyStyle(workbook, 0, [
      { r1: 0, c1: 0, r2: sheet.rows - 1, c2: sheet.cols - 1 },
    ], { b: 1 });

    const cells = Object.keys(next.sheets[0].cells).length;
    // Заполненные перекрашены все, пустота вокруг — в разумных пределах.
    expect(cells).toBeLessThan(SHEET_LIMITS.cells);
    for (let row = 0; row < 300; row++) {
      expect(next.styles[next.sheets[0].cells[cellRef(row, 0)].s!]).toEqual({ b: 1 });
    }
  });
});

describe("ввод и форматы", () => {
  it("распознаёт числа с запятой и пробелами", () => {
    expect(parseInput("1 234,50").value).toBe(1234.5);
    expect(parseInput("-0,5").value).toBe(-0.5);
  });

  it("не превращает коды в числа", () => {
    expect(parseInput("007").value).toBe("007");
    expect(parseInput("+79001234567").value).toBe("+79001234567");
  });

  it("узнаёт проценты, деньги и даты", () => {
    expect(parseInput("15%")).toMatchObject({ value: 0.15, fmt: FORMATS.percent });
    expect(parseInput("1 200 ₽")).toMatchObject({ value: 1200, fmt: FORMATS.rub });
    expect(parseInput("31.08.2026").fmt).toBe(FORMATS.date);
    // 31 февраля датой не является — остаётся текстом.
    expect(parseInput("31.02.2026").value).toBe("31.02.2026");
  });

  it("показывает числа по формату", () => {
    // Разделитель разрядов — неразрывный пробел: число не должно переноситься
    // по строке посреди самого себя.
    expect(formatValue(1234.5, FORMATS.thousandsDecimal)).toBe("1 234,50");
    expect(formatValue(0.1234, FORMATS.percentDecimal)).toBe("12,34%");
    expect(formatValue(0.1 + 0.2)).toBe("0,3");
    expect(formatValue(parseInput("31.08.2026").value, FORMATS.date)).toBe("31.08.2026");
  });

  it("приводит чужие коды форматов к своим", () => {
    expect(normalizeNumFmt("#,##0.00")).toBe(FORMATS.thousandsDecimal);
    expect(normalizeNumFmt("0.00%")).toBe(FORMATS.percentDecimal);
    expect(normalizeNumFmt("dd/mm/yyyy")).toBe(FORMATS.date);
    expect(normalizeNumFmt("General")).toBeUndefined();
  });
});

describe("строки и колонки", () => {
  it("вставка строки двигает ссылки формул", () => {
    const workbook = emptyWorkbook("Л");
    const sheet = workbook.sheets[0];
    setCell(sheet, 0, 0, { v: 1 });
    setCell(sheet, 1, 0, { v: 2 });
    setCell(sheet, 2, 0, { f: "SUM(A1:A2)" });

    const next = insertRows(workbook, 0, 1, 1);
    expect(next.sheets[0].cells.A4?.f).toBe("SUM(A1:A3)");
    recalculate(next);
    expect(next.sheets[0].cells.A4?.v).toBe(3);
  });

  it("удаление строки ломает ссылку на неё, а соседние подтягивает", () => {
    const workbook = emptyWorkbook("Л");
    const sheet = workbook.sheets[0];
    setCell(sheet, 0, 0, { v: 5 });
    setCell(sheet, 1, 0, { v: 7 });
    setCell(sheet, 2, 1, { f: "A1" });
    setCell(sheet, 3, 1, { f: "A2" });

    const next = deleteRows(workbook, 0, 0, 1);
    expect(next.sheets[0].cells.B2?.f).toBe("#REF!");
    expect(next.sheets[0].cells.B3?.f).toBe("A1");
  });

  it("сортировка переносит строку целиком", () => {
    const workbook = emptyWorkbook("Л");
    const sheet = workbook.sheets[0];
    setCell(sheet, 0, 0, { v: "б" });
    setCell(sheet, 0, 1, { v: 2 });
    setCell(sheet, 1, 0, { v: "а" });
    setCell(sheet, 1, 1, { v: 1 });

    const next = sortRange(
      workbook,
      0,
      { r1: 0, c1: 0, r2: 1, c2: 1 },
      0,
      "asc",
      (a, b) => String(a?.v ?? "").localeCompare(String(b?.v ?? "")),
    );
    expect(next.sheets[0].cells.A1.v).toBe("а");
    expect(next.sheets[0].cells.B1.v).toBe(1);
  });

  it("объединение оставляет только левую верхнюю ячейку", () => {
    const workbook = emptyWorkbook("Л");
    setCell(workbook.sheets[0], 0, 0, { v: "шапка" });
    setCell(workbook.sheets[0], 0, 1, { v: "лишнее" });
    const next = mergeRange(workbook, 0, { r1: 0, c1: 0, r2: 0, c2: 1 });
    expect(next.sheets[0].merges).toEqual(["A1:B1"]);
    expect(next.sheets[0].cells.B1).toBeUndefined();
  });
});

describe("csv", () => {
  it("угадывает разделитель русской выгрузки", () => {
    expect(detectDelimiter("имя;сумма\nа;1\nб;2")).toBe(";");
    expect(detectDelimiter("name,total\na,1")).toBe(",");
  });

  it("разбирает кавычки и переносы внутри поля", () => {
    const rows = parseCsv('a;"б;в";"стро\nка"\n1;2;3');
    expect(rows[0]).toEqual(["a", "б;в", "стро\nка"]);
    expect(rows[1]).toEqual(["1", "2", "3"]);
  });

  it("csv превращается в книгу с числами, а не строками", () => {
    const workbook = csvToWorkbook("товар;цена\nхлеб;45,50\nмолоко;89");
    const sheet = workbook.sheets[0];
    expect(sheet.cells.A1.v).toBe("товар");
    expect(sheet.cells.B2.v).toBe(45.5);
    expect(sheet.frozen).toEqual({ rows: 1, cols: 0 });
  });

  it("выгрузка возвращает то же, что видно на экране", () => {
    const workbook = csvToWorkbook("a;b\n1;2");
    const sheet = workbook.sheets[0];
    const csv = sheetToCsv(sheet, (row, col) => String(sheet.cells[cellRef(row, col)]?.v ?? ""));
    expect(csv).toBe("﻿a;b\r\n1;2");
  });
});
