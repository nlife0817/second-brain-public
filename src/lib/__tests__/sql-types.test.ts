// Даты и отметки времени обязаны приезжать из базы строками.
//
// Регресс, ради которого написан файл: типы в TS объявляют `created_at` как
// `string`, но pg.js по умолчанию разбирает timestamptz в `Date`. Пока данные
// шли только через JSON API, разница пряталась внутри `JSON.stringify`; после
// перехода экранов на серверный рендер объект выборки попадает в компонент как
// есть, и сортировка сводного списка падала с
// «created_at.localeCompare is not a function».

import { describe, expect, it } from "vitest";
import { PG_TYPES } from "../sql";

describe("PG_TYPES", () => {
  it("покрывает OID даты и отметки времени", () => {
    const covered = Object.values(PG_TYPES).flatMap((t) => t.from);
    expect(covered).toContain(1082); // date
    expect(covered).toContain(1184); // timestamptz
  });

  it("отдаёт день как есть, без разбора в Date", () => {
    expect(PG_TYPES.date.parse("2026-01-31")).toBe("2026-01-31");
  });

  it("отдаёт отметку времени строкой", () => {
    const parsed = PG_TYPES.timestamptz.parse("2026-07-26 12:00:00.123456+00");
    expect(typeof parsed).toBe("string");
    expect(parsed).toBe("2026-07-26T12:00:00.123Z");
  });

  it("формат совпадает с JSON.stringify(Date) — ответы API не меняются", () => {
    for (const raw of [
      "2026-07-26 12:00:00+00",
      "2026-07-26 12:00:00.5+00",
      "2026-01-01 07:30:15.987654+07",
    ]) {
      expect(JSON.stringify(PG_TYPES.timestamptz.parse(raw))).toBe(JSON.stringify(new Date(raw)));
    }
  });

  it("разобранные значения сравнимы как строки — на этом держится сортировка", () => {
    const older = PG_TYPES.timestamptz.parse("2026-07-26 12:00:00+00");
    const newer = PG_TYPES.timestamptz.parse("2026-07-26 12:00:01+00");
    expect(older.localeCompare(newer)).toBeLessThan(0);
  });

  it("принимает обратно и строку, и Date — параметры запросов не ломаются", () => {
    const date = new Date("2026-07-26T12:00:00.000Z");
    expect(PG_TYPES.timestamptz.serialize(date.toISOString())).toBe("2026-07-26T12:00:00.000Z");
    expect(PG_TYPES.timestamptz.serialize(date as never)).toBe("2026-07-26T12:00:00.000Z");
    expect(PG_TYPES.date.serialize(date as never)).toBe("2026-07-26");
    expect(PG_TYPES.date.serialize("2026-07-26")).toBe("2026-07-26");
  });
});
