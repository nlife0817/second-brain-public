import { describe, expect, it } from "vitest";
import { recalculate, evaluateFormula } from "../sheet/engine";
import { formulaToText, offsetFormula, parseFormula } from "../sheet/formula";
import { emptyWorkbook, setCell, type Workbook } from "../sheet/model";

/** Книга из карты «A1» → значение или формула («=SUM(...)»). */
function book(cells: Record<string, string | number | boolean>): Workbook {
  const workbook = emptyWorkbook("Лист 1");
  const sheet = workbook.sheets[0];
  for (const [ref, raw] of Object.entries(cells)) {
    const at = /^([A-Z]+)(\d+)$/.exec(ref)!;
    let col = 0;
    for (const ch of at[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    const row = Number(at[2]) - 1;
    if (typeof raw === "string" && raw.startsWith("=")) {
      setCell(sheet, row, col - 1, { f: raw.slice(1) });
    } else {
      setCell(sheet, row, col - 1, { v: raw });
    }
  }
  return workbook;
}

/** Посчитать книгу и вернуть значение ячейки. */
function valueOf(workbook: Workbook, ref: string) {
  recalculate(workbook, new Date(Date.UTC(2026, 7, 31)));
  return workbook.sheets[0].cells[ref]?.v;
}

describe("разбор формул", () => {
  it("держит приоритет операций", () => {
    expect(valueOf(book({ A1: "=2+2*2" }), "A1")).toBe(6);
    expect(valueOf(book({ A1: "=(2+2)*2" }), "A1")).toBe(8);
    expect(valueOf(book({ A1: "=2^3^2" }), "A1")).toBe(512); // степень правоассоциативна
    expect(valueOf(book({ A1: "=-2^2" }), "A1")).toBe(4);
  });

  it("понимает и запятую, и точку с запятой как разделитель аргументов", () => {
    expect(valueOf(book({ A1: "=SUM(1,2,3)" }), "A1")).toBe(6);
    expect(valueOf(book({ A1: "=SUM(1;2;3)" }), "A1")).toBe(6);
  });

  it("процент и конкатенация", () => {
    expect(valueOf(book({ A1: "=50%" }), "A1")).toBe(0.5);
    expect(valueOf(book({ A1: '="цена: "&12' }), "A1")).toBe("цена: 12");
  });

  it("непонятная формула даёт #NAME?, а не роняет пересчёт", () => {
    const workbook = book({ A1: "=ЧТОТОСТРАННОЕ(", A2: "=1+1" });
    expect(valueOf(workbook, "A1")).toBe("#NAME?");
    expect(workbook.sheets[0].cells.A2?.v).toBe(2);
  });

  it("собирает формулу обратно в текст", () => {
    expect(formulaToText(parseFormula("=SUM($A$1:B2)*2"))).toBe("SUM($A$1:B2)*2");
    expect(formulaToText(parseFormula('="a""b"'))).toBe('"a""b"');
  });
});

describe("ссылки", () => {
  it("считает диапазоны и ссылки на другой лист", () => {
    const workbook = book({ A1: 1, A2: 2, A3: 3, B1: "=SUM(A1:A3)" });
    workbook.sheets.push({ id: "s2", name: "Лист 2", rows: 10, cols: 10, cells: { A1: { v: 10 } } });
    setCell(workbook.sheets[0], 1, 1, { f: "'Лист 2'!A1*2" });
    recalculate(workbook);
    expect(workbook.sheets[0].cells.B1?.v).toBe(6);
    expect(workbook.sheets[0].cells.B2?.v).toBe(20);
  });

  it("цикл помечается ошибкой, а соседи считаются", () => {
    const workbook = book({ A1: "=B1", B1: "=A1", C1: "=2+2" });
    recalculate(workbook);
    expect(workbook.sheets[0].cells.A1?.v).toBe("#CYCLE!");
    expect(workbook.sheets[0].cells.B1?.v).toBe("#CYCLE!");
    expect(workbook.sheets[0].cells.C1?.v).toBe(4);
  });

  it("ссылка на себя — тоже цикл", () => {
    expect(valueOf(book({ A1: "=A1+1" }), "A1")).toBe("#CYCLE!");
  });

  it("длинная цепочка не переполняет стек", () => {
    const workbook = emptyWorkbook("Лист 1");
    const sheet = workbook.sheets[0];
    sheet.rows = 3000;
    setCell(sheet, 0, 0, { v: 1 });
    for (let row = 1; row < 3000; row++) setCell(sheet, row, 0, { f: `A${row}+1` });
    recalculate(workbook);
    expect(sheet.cells.A3000?.v).toBe(3000);
  });

  it("ссылка на весь столбец Excel обрезается по размеру листа", () => {
    // Реальные файлы полны формул вида SUM(A1:A1048576) — так Excel записывает
    // «весь столбец». Разворачивать миллион пустых клеток на каждый пересчёт
    // значит полсекунды на одну такую ячейку.
    const workbook = book({ A1: 1, A2: 2, B1: "=SUM(A1:A1048576)" });
    const started = Date.now();
    recalculate(workbook);
    expect(workbook.sheets[0].cells.B1?.v).toBe(3);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("при копировании относительная ссылка едет, а $-ссылка стоит", () => {
    expect(offsetFormula("A1*$B$1", 2, 0)).toBe("A3*$B$1");
    expect(offsetFormula("A1", -5, 0)).toBe("#REF!");
  });
});

describe("функции", () => {
  const sample = () => book({ A1: "Яблоко", A2: "Груша", A3: "Яблоко", B1: 10, B2: 20, B3: 30 });

  it("агрегаты пропускают текст, но не глотают ошибку", () => {
    expect(valueOf(book({ A1: 1, A2: "текст", A3: 3, B1: "=SUM(A1:A3)" }), "B1")).toBe(4);
    expect(valueOf(book({ A1: "=1/0", B1: "=SUM(A1:A1)" }), "B1")).toBe("#DIV/0!");
  });

  it("SUMIF и COUNTIF с условиями", () => {
    const workbook = sample();
    setCell(workbook.sheets[0], 0, 3, { f: 'SUMIF(A1:A3;"Яблоко";B1:B3)' });
    setCell(workbook.sheets[0], 1, 3, { f: 'COUNTIF(B1:B3;">15")' });
    recalculate(workbook);
    expect(workbook.sheets[0].cells.D1?.v).toBe(40);
    expect(workbook.sheets[0].cells.D2?.v).toBe(2);
  });

  it("VLOOKUP ищет точное совпадение по умолчанию", () => {
    const workbook = sample();
    setCell(workbook.sheets[0], 0, 3, { f: 'VLOOKUP("Груша";A1:B3;2)' });
    setCell(workbook.sheets[0], 1, 3, { f: 'VLOOKUP("Слива";A1:B3;2)' });
    recalculate(workbook);
    expect(workbook.sheets[0].cells.D1?.v).toBe(20);
    expect(workbook.sheets[0].cells.D2?.v).toBe("#N/A");
  });

  it("IFERROR перехватывает ошибку аргумента", () => {
    expect(valueOf(book({ A1: '=IFERROR(1/0;"—")' }), "A1")).toBe("—");
  });

  it("ROUND округляет половину от нуля, как Excel", () => {
    expect(valueOf(book({ A1: "=ROUND(2.5;0)" }), "A1")).toBe(3);
    expect(valueOf(book({ A1: "=ROUND(-2.5;0)" }), "A1")).toBe(-3);
    expect(valueOf(book({ A1: "=ROUND(1.005;2)" }), "A1")).toBe(1.01);
  });

  it("даты считаются серийными числами", () => {
    const workbook = book({ A1: "=DATE(2026;8;31)-DATE(2026;8;1)" });
    expect(valueOf(workbook, "A1")).toBe(30);
    expect(evaluateFormula(book({}), 0, "YEAR(DATE(2026;8;31))")).toBe(2026);
  });

  it("логические функции пропускают пустые ячейки", () => {
    expect(valueOf(book({ A1: true, B1: "=AND(A1;C1)" }), "B1")).toBe(true);
    expect(valueOf(book({ A1: 5, B1: "=IF(A1>3;\"много\";\"мало\")" }), "B1")).toBe("много");
  });
});
