import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { recalculate } from "../sheet/engine";
import { FORMATS } from "../sheet/format";
import { dateToSerial } from "../sheet/functions";
import { workbookFromXlsx, workbookToXlsx } from "../sheet/xlsx";

/** Файл, похожий на то, что приносят из Excel: формулы, форматы, объединение. */
async function sample(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Смета");
  ws.columns = [{ width: 28 }, { width: 12 }];
  ws.getCell("A1").value = "Позиция";
  ws.getCell("A1").font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8734A" } };
  ws.getCell("A1").alignment = { horizontal: "center" };
  ws.getCell("B1").value = "Сумма";
  ws.getCell("A2").value = "Работы";
  ws.getCell("B2").value = 1000;
  ws.getCell("B2").numFmt = "#,##0.00";
  ws.getCell("A2").border = {
    bottom: { style: "thin", color: { argb: "FF111827" } },
    left: { style: "medium" },
  };
  ws.getCell("A3").value = "Материалы";
  ws.getCell("B3").value = 2000;
  ws.getCell("B4").value = { formula: "SUM(B2:B3)", result: 3000 };
  ws.getCell("A6").value = new Date(Date.UTC(2026, 8, 15));
  ws.getCell("A6").numFmt = "dd.mm.yyyy";
  ws.mergeCells("A8:B8");
  ws.getCell("A8").value = "Примечание";
  ws.views = [{ state: "frozen", ySplit: 1 }];
  // Прячем строку С СОДЕРЖИМЫМ: пустую скрытую строку exceljs в файл не пишет
  // вовсе (проверено), и такой фикстурой мы бы проверяли не себя, а библиотеку.
  ws.getRow(3).hidden = true;
  ws.getColumn(3).hidden = true;

  const second = wb.addWorksheet("Ставки");
  second.getCell("A1").value = { formula: "'Смета'!B4*2", result: 6000 };

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("импорт xlsx", () => {
  it("переносит значения, формулы и форматы", async () => {
    const { workbook, notes } = await workbookFromXlsx(await sample());
    expect(notes).toEqual([]);
    expect(workbook.sheets.map((s) => s.name)).toEqual(["Смета", "Ставки"]);

    const sheet = workbook.sheets[0];
    expect(sheet.cells.B2.v).toBe(1000);
    expect(sheet.cells.B4.f).toBe("SUM(B2:B3)");
    expect(workbook.styles[sheet.cells.B2.s!].fmt).toBe(FORMATS.thousandsDecimal);

    const header = workbook.styles[sheet.cells.A1.s!];
    expect(header).toMatchObject({ b: 1, c: "#ffffff", bg: "#e8734a", ha: "center" });
  });

  it("дата приезжает числом и датным форматом", async () => {
    const { workbook } = await workbookFromXlsx(await sample());
    const sheet = workbook.sheets[0];
    expect(sheet.cells.A6.v).toBe(dateToSerial(new Date(Date.UTC(2026, 8, 15))));
    expect(workbook.styles[sheet.cells.A6.s!].fmt).toBe(FORMATS.date);
  });

  it("объединённая область оставляет значение только в левой верхней ячейке", async () => {
    // exceljs отдаёт значение объединения в КАЖДОЙ его ячейке; без отсева
    // примечание задваивалось бы по всем колонкам — и на экране после снятия
    // объединения, и в выгрузке в csv.
    const { workbook } = await workbookFromXlsx(await sample());
    const sheet = workbook.sheets[0];
    expect(sheet.merges).toEqual(["A8:B8"]);
    expect(sheet.cells.A8.v).toBe("Примечание");
    expect(sheet.cells.B8).toBeUndefined();
  });

  it("границы приезжают цветом, а линия без цвета считается чёрной", async () => {
    const { workbook } = await workbookFromXlsx(await sample());
    const sheet = workbook.sheets[0];
    const style = workbook.styles[sheet.cells.A2.s!];
    expect(style.bb).toBe("#111827");
    // Толщину не храним, но саму линию терять нельзя — иначе смета приезжает
    // без рамки, а это первое, что человек замечает.
    expect(style.bl).toBe("#111827");
    expect(style.bt).toBeUndefined();
  });

  it("закрепление и ширины колонок переносятся", async () => {
    const { workbook } = await workbookFromXlsx(await sample());
    const sheet = workbook.sheets[0];
    expect(sheet.frozen).toEqual({ rows: 1, cols: 0 });
    expect(sheet.widths?.["0"]).toBeGreaterThan(150);
  });

  it("формула считается заново, а не берётся из файла", async () => {
    const { workbook } = await workbookFromXlsx(await sample());
    recalculate(workbook);
    expect(workbook.sheets[0].cells.B4.v).toBe(3000);
    // Ссылка на другой лист по имени продолжает работать после переноса.
    expect(workbook.sheets[1].cells.A1.v).toBe(6000);
  });
});

describe("выгрузка xlsx", () => {
  it("скрытые строки и колонки переносятся в обе стороны", async () => {
    const { workbook } = await workbookFromXlsx(await sample());
    expect(workbook.sheets[0].hiddenR).toContain(2);
    expect(workbook.sheets[0].hiddenC).toContain(2);

    const again = await workbookFromXlsx(
      new Uint8Array(await workbookToXlsx(workbook, "Смета")),
    );
    expect(again.workbook.sheets[0].hiddenR).toContain(2);
    expect(again.workbook.sheets[0].hiddenC).toContain(2);
  });

  it("границы переживают круг через файл", async () => {
    const { workbook } = await workbookFromXlsx(await sample());
    const again = await workbookFromXlsx(
      new Uint8Array(await workbookToXlsx(workbook, "Смета")),
    );
    const style = again.workbook.styles[again.workbook.sheets[0].cells.A2.s!];
    expect(style.bb).toBe("#111827");
    expect(style.bl).toBe("#111827");
  });

  it("книга переживает круг: наш файл читается как исходный", async () => {
    const { workbook } = await workbookFromXlsx(await sample());
    recalculate(workbook);
    const buffer = await workbookToXlsx(workbook, "Смета");

    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = back.getWorksheet("Смета")!;

    expect(ws.getCell("A1").font?.bold).toBe(true);
    expect(ws.getCell("B4").value).toMatchObject({ formula: "SUM(B2:B3)", result: 3000 });
    expect(ws.getCell("B2").numFmt).toBe("#,##0.00");
    // Дата уходит числом с датным форматом — так её хранит и сам Excel.
    expect(ws.getCell("A6").value).toBeInstanceOf(Date);
    expect(ws.model.merges).toContain("A8:B8");
    expect(back.getWorksheet("Ставки")!.getCell("A1").value).toMatchObject({
      formula: "'Смета'!B4*2",
    });
  });
});
