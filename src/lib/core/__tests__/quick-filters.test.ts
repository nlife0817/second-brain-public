// Быстрые фильтры телефона поверх той же модели условий, что и конструктор на
// десктопе: чип обязан править только свою группу и не трогать собранное руками.

import { describe, expect, it } from "vitest";
import {
  ME_VALUE,
  SHOW_VALUE,
  quickFilterValues,
  setQuickFilterValues,
  toggleQuickFilterValue,
  type FilterGroup,
} from "../views";

function group(id: string, conditions: Array<[string, string]>, logic: "and" | "or" = "or"): FilterGroup {
  return {
    id,
    logic,
    conditions: conditions.map(([field, value], i) => ({
      id: `${id}-${i}`,
      field: field as FilterGroup["conditions"][number]["field"],
      operator: "is",
      value,
    })),
  };
}

describe("quickFilterValues", () => {
  it("читает значения своей группы", () => {
    const groups = [group("g1", [["project", "p1"], ["project", "p2"]])];
    expect(quickFilterValues(groups, "project")).toEqual(["p1", "p2"]);
    expect(quickFilterValues(groups, "status")).toEqual([]);
  });

  it("не считает своей группу со смешанными полями", () => {
    const groups = [group("g1", [["project", "p1"], ["status", "s1"]])];
    expect(quickFilterValues(groups, "project")).toEqual([]);
  });

  it("не считает своей группу с другим оператором", () => {
    const groups: FilterGroup[] = [
      { id: "g1", logic: "and", conditions: [{ id: "c1", field: "project", operator: "is_not", value: "p1" }] },
    ];
    expect(quickFilterValues(groups, "project")).toEqual([]);
  });
});

describe("setQuickFilterValues", () => {
  it("заводит группу с ИЛИ внутри", () => {
    const next = setQuickFilterValues([], "project", ["p1", "p2"]);
    expect(next).toHaveLength(1);
    expect(next[0].logic).toBe("or");
    expect(next[0].conditions.map((c) => c.value)).toEqual(["p1", "p2"]);
  });

  it("пустой выбор убирает группу", () => {
    const groups = [group("g1", [["project", "p1"]])];
    expect(setQuickFilterValues(groups, "project", [])).toEqual([]);
  });

  it("держит группу на её месте и не трогает чужие", () => {
    const handmade = group("hand", [["status", "s1"], ["priority", "high"]], "and");
    const groups = [group("g1", [["project", "p1"]]), handmade];
    const next = setQuickFilterValues(groups, "project", ["p2"]);
    expect(next).toHaveLength(2);
    expect(next[0].conditions.map((c) => c.value)).toEqual(["p2"]);
    expect(next[0].id).toBe("g1");
    expect(next[1]).toBe(handmade);
  });

  it("схлопывает несколько своих групп по полю в одну", () => {
    const groups = [group("g1", [["project", "p1"]]), group("g2", [["project", "p2"]])];
    const next = setQuickFilterValues(groups, "project", ["p3"]);
    expect(next).toHaveLength(1);
    expect(next[0].conditions.map((c) => c.value)).toEqual(["p3"]);
  });
});

describe("toggleQuickFilterValue", () => {
  it("добавляет и снимает значение", () => {
    const on = toggleQuickFilterValue([], "assignee", ME_VALUE);
    expect(quickFilterValues(on, "assignee")).toEqual([ME_VALUE]);
    expect(toggleQuickFilterValue(on, "assignee", ME_VALUE)).toEqual([]);
  });

  it("переключатель видимости работает тем же механизмом", () => {
    const on = toggleQuickFilterValue([], "done", SHOW_VALUE);
    expect(quickFilterValues(on, "done")).toEqual([SHOW_VALUE]);
    expect(quickFilterValues(toggleQuickFilterValue(on, "done", SHOW_VALUE), "done")).toEqual([]);
  });
});
