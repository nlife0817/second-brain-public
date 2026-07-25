import { describe, expect, it } from "vitest";
import { nextOccurrence } from "../recurring";

const base = { byweekday: null, bymonthday: null };

describe("nextOccurrence", () => {
  it("ежедневно с интервалом", () => {
    expect(nextOccurrence({ ...base, freq: "daily", interval: 1 }, "2026-07-25")).toBe("2026-07-26");
    expect(nextOccurrence({ ...base, freq: "daily", interval: 3 }, "2026-07-25")).toBe("2026-07-28");
  });

  it("по будням пропускает выходные", () => {
    // 2026-07-24 — пятница
    expect(nextOccurrence({ ...base, freq: "weekdays", interval: 1 }, "2026-07-24")).toBe("2026-07-27");
  });

  it("еженедельно: следующий день из списка внутри недели", () => {
    // 2026-07-27 — понедельник, список [1,3] = пн, ср
    expect(
      nextOccurrence({ ...base, freq: "weekly", interval: 1, byweekday: [1, 3] }, "2026-07-27"),
    ).toBe("2026-07-29");
  });

  it("еженедельно с интервалом 2 не превращается в еженедельно", () => {
    // Понедельник + «каждые две недели по понедельникам» → через 14 дней.
    expect(
      nextOccurrence({ ...base, freq: "weekly", interval: 2, byweekday: [1] }, "2026-07-27"),
    ).toBe("2026-08-10");
  });

  it("ежемесячно: день месяца сохраняется", () => {
    expect(
      nextOccurrence({ ...base, freq: "monthly", interval: 1, bymonthday: 10 }, "2026-07-10"),
    ).toBe("2026-08-10");
  });

  it("ежемесячно: короткий месяц не переносит дату на следующий", () => {
    // 31 января → 28 февраля (2026 — не високосный), а не 3 марта.
    expect(
      nextOccurrence({ ...base, freq: "monthly", interval: 1, bymonthday: 31 }, "2026-01-31"),
    ).toBe("2026-02-28");
  });

  it("любая частота всегда двигает дату вперёд", () => {
    const from = "2026-07-25";
    for (const rule of [
      { ...base, freq: "daily" as const, interval: 1 },
      { ...base, freq: "weekdays" as const, interval: 1 },
      { ...base, freq: "weekly" as const, interval: 1, byweekday: [6] },
      { ...base, freq: "monthly" as const, interval: 1, bymonthday: 1 },
    ]) {
      expect(nextOccurrence(rule, from) > from, JSON.stringify(rule)).toBe(true);
    }
  });
});
