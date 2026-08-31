// План дня: раскладка «Моих задач», корзины группировки и готовые срезы. Всё
// это — про разницу между «когда должно быть готово» и «когда я этим займусь»,
// и именно её тесты и стерегут.

import { describe, expect, it } from "vitest";
import { daySections, todayLoad, unplannedStart } from "../day-plan";
import type { TaskListItem, TaskRow } from "../types";
import {
  FILTER_PRESETS,
  isPresetActive,
  makeMatchContext,
  matchesGroups,
  plannedBucket,
  togglePreset,
  NONE_VALUE,
  type FilterGroup,
} from "../views";

const TODAY = "2026-08-31";
const YESTERDAY = "2026-08-30";
const TOMORROW = "2026-09-01";

function task(over: Partial<TaskListItem> & { id: string }): TaskListItem {
  return {
    org_id: "o1",
    title: "Задача",
    status_id: null,
    priority: "none",
    start_date: null,
    start_time: null,
    due_date: null,
    due_time: null,
    planned_date: null,
    estimated_minutes: null,
    completed_at: null,
    parent_task_id: null,
    subtask_position: null,
    sprint_id: null,
    sprint_carry_count: 0,
    source: "app",
    created_by: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    assignees: [],
    tags: [],
    placements: [],
    subtask_count: 0,
    subtask_done_count: 0,
    comment_count: 0,
    ...over,
  };
}

function row(over: Partial<TaskRow> & { id: string }): TaskRow {
  return { ...task(over), field_values: {}, ...over };
}

/** «Сегодня» у контекста фиксировано: тест не должен зависеть от даты прогона. */
const ctx = makeMatchContext(null, new Date(2026, 7, 31, 12, 0, 0));

describe("daySections", () => {
  it("раскладывает по плану, а не по дедлайну", () => {
    const sections = daySections(
      [
        task({ id: "a", planned_date: YESTERDAY, due_date: "2026-09-10" }),
        task({ id: "b", planned_date: TODAY, due_date: "2026-09-10" }),
        task({ id: "c", planned_date: TOMORROW }),
        task({ id: "d", planned_date: "2026-09-20" }),
      ],
      { today: TODAY, showDone: false },
    );
    expect(sections.map((s) => s.key)).toEqual([
      "plan_overdue",
      "plan_today",
      "plan_tomorrow",
      "plan_later",
    ]);
    expect(sections[0].items.map((t) => t.id)).toEqual(["a"]);
  });

  it("задачи без плана разбирает по дедлайну — из них и наполняют день", () => {
    const sections = daySections(
      [
        task({ id: "late", due_date: YESTERDAY }),
        task({ id: "now", due_date: TODAY }),
        task({ id: "soon", due_date: "2026-09-05" }),
        task({ id: "never" }),
      ],
      { today: TODAY, showDone: false },
    );
    expect(sections.map((s) => s.key)).toEqual(["due_overdue", "due_today", "due_ahead", "no_date"]);
    // Каждой из них предлагается ровно одно действие — взять на сегодня.
    expect(sections.every((s) => s.action === "take")).toBe(true);
  });

  it("завершённые не попадают в просроченный план", () => {
    const done = task({ id: "d", planned_date: YESTERDAY, completed_at: "2026-08-30T10:00:00Z" });
    expect(daySections([done], { today: TODAY, showDone: false })).toEqual([]);
    const shown = daySections([done], { today: TODAY, showDone: true });
    expect(shown.map((s) => s.key)).toEqual(["done"]);
    expect(shown[0].action).toBeNull();
  });

  it("пустые разделы не показываются", () => {
    expect(daySections([], { today: TODAY, showDone: true })).toEqual([]);
  });

  it("граница «Без плана» находится по флагу, а не по имени раздела", () => {
    // Просроченных по сроку нет — граница обязана встать перед «Срок сегодня».
    const sections = daySections(
      [task({ id: "a", planned_date: TODAY }), task({ id: "b", due_date: TODAY })],
      { today: TODAY, showDone: false },
    );
    expect(sections.map((s) => s.key)).toEqual(["plan_today", "due_today"]);
    expect(unplannedStart(sections)).toBe(1);
  });

  it("границы нет, когда план пуст целиком", () => {
    const sections = daySections([task({ id: "b", due_date: TODAY })], { today: TODAY, showDone: false });
    expect(unplannedStart(sections)).toBe(-1);
  });

  it("нагрузка на день считает сегодняшний план вместе с сорванным", () => {
    const sections = daySections(
      [
        task({ id: "a", planned_date: YESTERDAY }),
        task({ id: "b", planned_date: TODAY }),
        task({ id: "c", planned_date: TOMORROW }),
        task({ id: "d", due_date: TODAY }),
      ],
      { today: TODAY, showDone: false },
    );
    expect(todayLoad(sections)).toBe(2);
  });
});

describe("plannedBucket", () => {
  it("разводит вчера, сегодня и завтра по своим корзинам", () => {
    expect(plannedBucket(YESTERDAY, ctx)).toBe("overdue");
    expect(plannedBucket(TODAY, ctx)).toBe("today");
    expect(plannedBucket(TOMORROW, ctx)).toBe("tomorrow");
    expect(plannedBucket(null, ctx)).toBe(NONE_VALUE);
  });

  it("считает по дню, а не по завершённости — как и корзина срока", () => {
    // Задача переезжает между группами от смены даты, а не от закрытия.
    expect(plannedBucket("2026-09-06", ctx)).toBe("week");
    expect(plannedBucket("2026-09-30", ctx)).toBe("later");
  });
});

describe("относительные операторы дат", () => {
  function matches(t: TaskRow, field: string, operator: string): boolean {
    const groups: FilterGroup[] = [
      {
        id: "g",
        logic: "and",
        conditions: [
          {
            id: "c",
            field: field as FilterGroup["conditions"][number]["field"],
            operator: operator as FilterGroup["conditions"][number]["operator"],
            value: "",
          },
        ],
      },
    ];
    return matchesGroups(t, groups, ctx);
  }

  it("«в будущем» отбирает не наступившие сроки", () => {
    expect(matches(row({ id: "a", due_date: TOMORROW }), "due_date", "is_future")).toBe(true);
    expect(matches(row({ id: "b", due_date: TODAY }), "due_date", "is_future")).toBe(false);
    expect(matches(row({ id: "c", due_date: YESTERDAY }), "due_date", "is_future")).toBe(false);
    // Без даты условие не выполняется: «в будущем» — это про поставленный срок.
    expect(matches(row({ id: "d" }), "due_date", "is_future")).toBe(false);
  });

  it("«сегодня или раньше» берёт и сегодняшний план, и несделанный вчерашний", () => {
    expect(matches(row({ id: "a", planned_date: TODAY }), "planned_date", "is_today_or_before")).toBe(true);
    expect(matches(row({ id: "b", planned_date: YESTERDAY }), "planned_date", "is_today_or_before")).toBe(true);
    expect(matches(row({ id: "c", planned_date: TOMORROW }), "planned_date", "is_today_or_before")).toBe(false);
  });

  it("завершённость «сегодня или раньше» не смотрит — её убирает переключатель «Готово»", () => {
    const done = row({ id: "a", planned_date: TODAY, completed_at: "2026-08-31T09:00:00Z" });
    expect(matches(done, "planned_date", "is_today_or_before")).toBe(true);
    // А вот «просрочено» завершённые отсекает — так было и у срока.
    expect(matches(done, "planned_date", "is_overdue")).toBe(false);
  });
});

describe("готовые срезы", () => {
  const today = FILTER_PRESETS.find((p) => p.id === "today")!;
  const ahead = FILTER_PRESETS.find((p) => p.id === "due_ahead")!;

  it("включается и выключается, не трогая набранное руками", () => {
    const manual: FilterGroup = {
      id: "manual",
      logic: "and",
      conditions: [{ id: "c", field: "priority", operator: "is", value: "urgent" }],
    };
    const on = togglePreset([manual], today);
    expect(isPresetActive(on, today)).toBe(true);
    expect(on).toHaveLength(2);

    const off = togglePreset(on, today);
    expect(isPresetActive(off, today)).toBe(false);
    expect(off).toEqual([manual]);
  });

  it("срезы независимы друг от друга", () => {
    const both = togglePreset(togglePreset([], today), ahead);
    expect(isPresetActive(both, today)).toBe(true);
    expect(isPresetActive(both, ahead)).toBe(true);
    expect(isPresetActive(togglePreset(both, today), ahead)).toBe(true);
  });

  it("срез «в работе сегодня» отбирает план на сегодня и раньше", () => {
    const groups = togglePreset([], today);
    expect(matchesGroups(row({ id: "a", planned_date: TODAY }), groups, ctx)).toBe(true);
    expect(matchesGroups(row({ id: "b", planned_date: YESTERDAY }), groups, ctx)).toBe(true);
    expect(matchesGroups(row({ id: "c", planned_date: TOMORROW }), groups, ctx)).toBe(false);
    expect(matchesGroups(row({ id: "d", due_date: TODAY }), groups, ctx)).toBe(false);
  });
});
