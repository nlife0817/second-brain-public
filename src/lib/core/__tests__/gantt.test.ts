import { describe, expect, it } from "vitest";
import {
  addDays,
  barOf,
  buildTicks,
  dayAt,
  diffDays,
  dragBar,
  ganttRange,
  isWeekend,
  spanOf,
  startOfWeek,
  widthOf,
  type GanttBar,
} from "../gantt";
import type { TaskRow } from "../types";

/** Минимальная строка списка: гант читает из неё только даты и завершённость. */
function task(over: Partial<TaskRow>): TaskRow {
  return {
    id: "t1",
    org_id: "o1",
    title: "Задача",
    status_id: null,
    priority: "none",
    start_date: null,
    start_time: null,
    due_date: null,
    due_time: null,
    estimated_minutes: null,
    completed_at: null,
    parent_task_id: null,
    subtask_position: null,
    sprint_id: null,
    sprint_carry_count: 0,
    source: "app",
    created_by: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    assignees: [],
    tags: [],
    placements: [],
    subtask_count: 0,
    subtask_done_count: 0,
    comment_count: 0,
    field_values: {},
    ...over,
  };
}

describe("арифметика дней", () => {
  it("сложение переходит через границу месяца и года", () => {
    expect(addDays("2026-07-30", 3)).toBe("2026-08-02");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("високосный февраль не теряется", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(diffDays("2028-02-01", "2028-03-01")).toBe(29);
  });

  it("выходные — суббота и воскресенье", () => {
    // 2026-08-01 — суббота.
    expect(isWeekend("2026-08-01")).toBe(true);
    expect(isWeekend("2026-08-02")).toBe(true);
    expect(isWeekend("2026-08-03")).toBe(false);
  });

  it("неделя начинается с понедельника", () => {
    expect(startOfWeek("2026-08-02")).toBe("2026-07-27"); // воскресенье → пн той же недели
    expect(startOfWeek("2026-07-27")).toBe("2026-07-27");
  });
});

describe("barOf", () => {
  it("задача без дат полосы не получает", () => {
    expect(barOf(task({}), "2026-07-30")).toBeNull();
  });

  it("начало и срок дают отрезок", () => {
    const bar = barOf(task({ start_date: "2026-07-20", due_date: "2026-07-24" }), "2026-07-30")!;
    expect(bar.start).toBe("2026-07-20");
    expect(bar.end).toBe("2026-07-24");
    expect(bar.milestone).toBe(false);
  });

  it("одна дата — веха, и жест двигает именно её", () => {
    const dueOnly = barOf(task({ due_date: "2026-07-24" }), "2026-07-01")!;
    expect(dueOnly.milestone).toBe(true);
    expect(dragBar(dueOnly, "move", 2)).toEqual({ due_date: "2026-07-26" });

    const startOnly = barOf(task({ start_date: "2026-07-24" }), "2026-07-01")!;
    expect(startOnly.milestone).toBe(true);
    expect(dragBar(startOnly, "move", 2)).toEqual({ start_date: "2026-07-26" });
  });

  it("просрочка — только у незавершённой задачи", () => {
    expect(barOf(task({ due_date: "2026-07-01" }), "2026-07-30")!.overdue).toBe(true);
    expect(
      barOf(task({ due_date: "2026-07-01", completed_at: "2026-07-02T10:00:00Z" }), "2026-07-30")!
        .overdue,
    ).toBe(false);
  });

  it("начало позже срока помечается, а не переворачивается молча", () => {
    const bar = barOf(task({ start_date: "2026-07-25", due_date: "2026-07-20" }), "2026-07-01")!;
    expect(bar.invalid).toBe(true);
    expect(bar.start).toBe("2026-07-20");
    expect(bar.end).toBe("2026-07-20");
  });
});

describe("ganttRange", () => {
  const empty: GanttBar[] = [];

  it("пустое полотно всё равно показывает окно вокруг сегодня", () => {
    const range = ganttRange(empty, "2026-07-30", "day");
    expect(range.from < "2026-07-30").toBe(true);
    expect(range.to > "2026-07-30").toBe(true);
  });

  it("сегодня всегда попадает в окно, как бы далеко ни лежали задачи", () => {
    const far = barOf(task({ start_date: "2027-01-10", due_date: "2027-01-20" }), "2026-07-30")!;
    const range = ganttRange([far], "2026-07-30", "day");
    expect(range.from <= "2026-07-30").toBe(true);
    expect(range.to >= "2027-01-20").toBe(true);
  });

  it("края ровные: неделя с понедельника, месяц с первого числа", () => {
    const bar = barOf(task({ start_date: "2026-07-20", due_date: "2026-07-24" }), "2026-07-22")!;
    const week = ganttRange([bar], "2026-07-22", "day");
    expect(startOfWeek(week.from)).toBe(week.from);

    const month = ganttRange([bar], "2026-07-22", "month");
    expect(month.from.slice(8)).toBe("01");
  });
});

describe("шкала", () => {
  it("подписи месяцев обрезаны по краям окна", () => {
    const range = { from: "2026-07-15", to: "2026-08-10" };
    const { major } = buildTicks(range, "day");
    expect(major[0].start).toBe("2026-07-15");
    expect(major[0].days).toBe(17); // 15–31 июля
    expect(major[1].start).toBe("2026-08-01");
    expect(major[1].days).toBe(10);
  });

  it("сумма делений равна длине окна", () => {
    const range = { from: "2026-07-15", to: "2026-09-03" };
    const total = diffDays(range.from, range.to) + 1;
    for (const scale of ["day", "week", "month"] as const) {
      const { major, minor } = buildTicks(range, scale);
      expect(major.reduce((s, t) => s + t.days, 0)).toBe(total);
      expect(minor.reduce((s, t) => s + t.days, 0)).toBe(total);
    }
  });
});

describe("геометрия", () => {
  it("конец полосы включительный: один день — это день ширины", () => {
    expect(widthOf({ start: "2026-07-20", end: "2026-07-20" }, "day")).toBe(34);
    expect(widthOf({ start: "2026-07-20", end: "2026-07-21" }, "day")).toBe(68);
  });

  it("день под курсором и обратный отсчёт сходятся", () => {
    const range = { from: "2026-07-01" };
    expect(dayAt(0, range, "day")).toBe("2026-07-01");
    expect(dayAt(34 * 5 + 10, range, "day")).toBe("2026-07-06");
  });
});

describe("dragBar", () => {
  const bar = barOf(task({ start_date: "2026-07-20", due_date: "2026-07-24" }), "2026-07-01")!;

  it("перенос двигает обе границы", () => {
    expect(dragBar(bar, "move", 3)).toEqual({ start_date: "2026-07-23", due_date: "2026-07-27" });
  });

  it("нулевой сдвиг не порождает патча", () => {
    expect(dragBar(bar, "move", 0)).toEqual({});
  });

  it("растягивание не выворачивает полосу наизнанку", () => {
    expect(dragBar(bar, "resize-start", 99)).toEqual({ start_date: "2026-07-24" });
    expect(dragBar(bar, "resize-end", -99)).toEqual({ due_date: "2026-07-20" });
  });
});

describe("spanOf", () => {
  it("охват группы — от самого раннего начала до самого позднего конца", () => {
    const bars = [
      barOf(task({ id: "a", start_date: "2026-07-20", due_date: "2026-07-24" }), "2026-07-01")!,
      barOf(task({ id: "b", start_date: "2026-07-10", due_date: "2026-07-12" }), "2026-07-01")!,
      barOf(task({ id: "c", due_date: "2026-08-01" }), "2026-07-01")!,
    ];
    expect(spanOf(bars)).toEqual({ from: "2026-07-10", to: "2026-08-01" });
    expect(spanOf([])).toBeNull();
  });
});
