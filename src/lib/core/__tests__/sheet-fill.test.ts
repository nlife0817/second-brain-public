import { describe, expect, it } from "vitest";
import { continueSeries, fillDownExtent, fillRange } from "../sheet/fill";
import { FORMATS } from "../sheet/format";
import { dateToSerial } from "../sheet/functions";
import { emptyWorkbook, getCell, setCell, type Workbook } from "../sheet/model";
import { styleIndex } from "../sheet/ops";

const numbers = (values: number[]) =>
  values.map((value) => ({ value, formula: false }));
const texts = (values: string[]) => values.map((value) => ({ value, formula: false }));
const dates = (values: Date[]) =>
  values.map((value) => ({ value: dateToSerial(value), fmt: FORMATS.date, formula: false }));

describe("продолжение ряда", () => {
  it("одно число копируется, два продолжаются", () => {
    // Так ведут себя и Excel, и Google Sheets: размножить цену «1000» по
    // колонке нужно куда чаще, чем получить из неё 1001, 1002.
    expect(continueSeries(numbers([1000]), 3)).toEqual([1000, 1000, 1000]);
    expect(continueSeries(numbers([1, 2]), 3)).toEqual([3, 4, 5]);
    expect(continueSeries(numbers([10, 20, 30]), 2)).toEqual([40, 50]);
  });

  it("ряд с неравным шагом повторяется по кругу, а не выдумывает шаг", () => {
    expect(continueSeries(numbers([1, 2, 4]), 4)).toEqual([1, 2, 4, 1]);
  });

  it("дробный шаг не тащит хвосты двоичной арифметики", () => {
    expect(continueSeries(numbers([0.1, 0.2]), 2)).toEqual([0.3, 0.4]);
  });

  it("одна дата продолжается по дню", () => {
    const result = continueSeries(dates([new Date(Date.UTC(2026, 7, 31))]), 2);
    expect(result).toEqual([
      dateToSerial(new Date(Date.UTC(2026, 8, 1))),
      dateToSerial(new Date(Date.UTC(2026, 8, 2))),
    ]);
  });

  it("первые числа месяцев продолжаются месяцами, а не 31 днём", () => {
    const result = continueSeries(
      dates([new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 1, 1))]),
      2,
    );
    expect(result).toEqual([
      dateToSerial(new Date(Date.UTC(2026, 2, 1))),
      dateToSerial(new Date(Date.UTC(2026, 3, 1))),
    ]);
  });

  it("31 января плюс месяц — это конец февраля, а не 3 марта", () => {
    const result = continueSeries(
      dates([new Date(Date.UTC(2026, 0, 31)), new Date(Date.UTC(2026, 1, 28))]),
      1,
    );
    // Числа месяца разные — ряда по месяцам нет, шаг остаётся в днях.
    expect(result).toEqual([dateToSerial(new Date(Date.UTC(2026, 2, 28)))]);
  });

  it("дни недели идут по списку и держат регистр", () => {
    expect(continueSeries(texts(["Понедельник"]), 2)).toEqual(["Вторник", "Среда"]);
    expect(continueSeries(texts(["пт"]), 3)).toEqual(["сб", "вс", "пн"]);
    expect(continueSeries(texts(["январь", "март"]), 2)).toEqual(["май", "июль"]);
  });

  it("текст с числом на конце продолжается с одной ячейки", () => {
    expect(continueSeries(texts(["Задача 1"]), 2)).toEqual(["Задача 2", "Задача 3"]);
    expect(continueSeries(texts(["Этап 2", "Этап 4"]), 2)).toEqual(["Этап 6", "Этап 8"]);
  });

  it("ведущие нули переживают продолжение", () => {
    expect(continueSeries(texts(["007"]), 2)).toEqual(["008", "009"]);
  });

  it("текст без числа повторяется по кругу", () => {
    expect(continueSeries(texts(["да", "нет"]), 3)).toEqual(["да", "нет", "да"]);
  });
});

describe("протягивание по листу", () => {
  const book = (): Workbook => {
    const workbook = emptyWorkbook();
    const sheet = workbook.sheets[0];
    setCell(sheet, 0, 0, { v: 10 });
    setCell(sheet, 1, 0, { v: 20 });
    setCell(sheet, 0, 1, { f: "A1*2", v: 20 });
    return workbook;
  };

  it("формула размножается со сдвигом ссылок", () => {
    const filled = fillRange(book(), 0, { r1: 0, c1: 1, r2: 0, c2: 1 }, { r1: 0, c1: 1, r2: 2, c2: 1 });
    const sheet = filled.sheets[0];
    expect(getCell(sheet, 1, 1)?.f).toBe("A2*2");
    expect(getCell(sheet, 2, 1)?.f).toBe("A3*2");
  });

  it("оформление образца едет вместе со значением", () => {
    const workbook = book();
    const index = styleIndex(workbook, { b: 1 });
    setCell(workbook.sheets[0], 0, 0, { v: 10, s: index });
    setCell(workbook.sheets[0], 1, 0, { v: 20, s: index });
    const filled = fillRange(workbook, 0, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 3, c2: 0 });
    expect(getCell(filled.sheets[0], 3, 0)).toEqual({ v: 40, s: index });
  });

  it("протягивание вверх продолжает ряд в другую сторону", () => {
    const workbook = emptyWorkbook();
    setCell(workbook.sheets[0], 5, 0, { v: 10 });
    setCell(workbook.sheets[0], 6, 0, { v: 20 });
    const filled = fillRange(
      workbook,
      0,
      { r1: 5, c1: 0, r2: 6, c2: 0 },
      { r1: 3, c1: 0, r2: 6, c2: 0 },
    );
    const sheet = filled.sheets[0];
    expect(getCell(sheet, 4, 0)?.v).toBe(0);
    expect(getCell(sheet, 3, 0)?.v).toBe(-10);
  });

  it("протягивание вправо идёт по колонкам", () => {
    const workbook = emptyWorkbook();
    setCell(workbook.sheets[0], 0, 0, { v: 1 });
    setCell(workbook.sheets[0], 0, 1, { v: 2 });
    const filled = fillRange(
      workbook,
      0,
      { r1: 0, c1: 0, r2: 0, c2: 1 },
      { r1: 0, c1: 0, r2: 0, c2: 3 },
    );
    expect(getCell(filled.sheets[0], 0, 3)?.v).toBe(4);
  });

  it("пустая ячейка образца стирает то, поверх чего протянули", () => {
    const workbook = emptyWorkbook();
    const sheet = workbook.sheets[0];
    setCell(sheet, 0, 0, { v: 1 });
    setCell(sheet, 2, 0, { v: "мусор" });
    setCell(sheet, 3, 0, { v: "мусор" });
    const filled = fillRange(workbook, 0, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 3, c2: 0 });
    expect(getCell(filled.sheets[0], 2, 0)?.v).toBe(1);
    expect(getCell(filled.sheets[0], 3, 0)).toBeUndefined();
  });

  it("скрытые строки протягивание пропускает, а не переписывает", () => {
    const workbook = emptyWorkbook();
    const sheet = workbook.sheets[0];
    setCell(sheet, 0, 0, { v: 1 });
    setCell(sheet, 1, 0, { v: 2 });
    setCell(sheet, 2, 0, { v: "спрятано" });

    // Строка 3 скрыта фильтром: человек её не видит, и запись в неё была бы
    // молчаливой правкой данных, о которой он не узнает.
    const filled = fillRange(
      workbook,
      0,
      { r1: 0, c1: 0, r2: 1, c2: 0 },
      { r1: 0, c1: 0, r2: 4, c2: 0 },
      { rows: new Set([2]) },
    );
    const result = filled.sheets[0];
    expect(getCell(result, 2, 0)?.v).toBe("спрятано");
    // Ряд продолжается по видимым строкам подряд, без пропуска значения.
    expect(getCell(result, 3, 0)?.v).toBe(3);
    expect(getCell(result, 4, 0)?.v).toBe(4);
  });

  it("двойной щелчок тянет до конца данных в соседней колонке", () => {
    const workbook = emptyWorkbook();
    const sheet = workbook.sheets[0];
    for (let row = 0; row < 5; row++) setCell(sheet, row, 0, { v: row });
    setCell(sheet, 0, 1, { f: "A1*2", v: 0 });
    expect(fillDownExtent(workbook, 0, { r1: 0, c1: 1, r2: 0, c2: 1 })).toBe(4);
  });
});
