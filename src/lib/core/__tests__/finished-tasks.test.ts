// «Архив» и «Готово» скрыты, пока их не включат в «Фильтрах». Правило живёт в
// двух местах сразу — в отборе строк (таблица и доска) и в решении, просить ли
// у сервера завершённые. Разъедутся они молча: список покажет пустоту.

import { describe, expect, it } from "vitest";
import { HIDE_VALUE, SHOW_VALUE, hiddenStatusIds, showsDone } from "../views";
import type { FilterGroup } from "../views";
import type { StatusKind } from "../types";

const STATUSES: Array<{ id: string; kind: StatusKind }> = [
  { id: "s-inbox", kind: "open" },
  { id: "s-doing", kind: "open" },
  { id: "s-done", kind: "done" },
  { id: "s-archive", kind: "archived" },
];

function group(...conditions: Array<[field: string, operator: string, value: string]>): FilterGroup {
  return {
    id: "g1",
    logic: "and",
    conditions: conditions.map(([field, operator, value], i) => ({
      id: `c${i}`,
      field: field as FilterGroup["conditions"][number]["field"],
      operator: operator as FilterGroup["conditions"][number]["operator"],
      value,
    })),
  };
}

describe("hiddenStatusIds", () => {
  it("без фильтров прячет и архивные, и завершающие статусы", () => {
    expect([...hiddenStatusIds([], STATUSES)].sort()).toEqual(["s-archive", "s-done"]);
  });

  it("«Архив = Показать» открывает архив, но не «Готово»", () => {
    const hidden = hiddenStatusIds([group(["archive", "is", SHOW_VALUE])], STATUSES);
    expect(hidden.has("s-archive")).toBe(false);
    expect(hidden.has("s-done")).toBe(true);
  });

  it("«Готово = Показать» открывает завершённые, но не архив", () => {
    const hidden = hiddenStatusIds([group(["done", "is", SHOW_VALUE])], STATUSES);
    expect(hidden.has("s-done")).toBe(false);
    expect(hidden.has("s-archive")).toBe(true);
  });

  it("оба переключателя работают вместе", () => {
    const hidden = hiddenStatusIds(
      [group(["archive", "is", SHOW_VALUE], ["done", "is", SHOW_VALUE])],
      STATUSES,
    );
    expect(hidden.size).toBe(0);
  });

  it("явное «Скрыть» ничего не открывает", () => {
    const hidden = hiddenStatusIds([group(["done", "is", HIDE_VALUE])], STATUSES);
    expect([...hidden].sort()).toEqual(["s-archive", "s-done"]);
  });

  it("рабочие статусы не прячет никогда", () => {
    const hidden = hiddenStatusIds([group(["done", "is", SHOW_VALUE])], STATUSES);
    expect(hidden.has("s-inbox")).toBe(false);
    expect(hidden.has("s-doing")).toBe(false);
  });

  it("логика группы на переключатель не влияет: он не предикат строки", () => {
    const or: FilterGroup = { ...group(["done", "is", SHOW_VALUE]), logic: "or" };
    expect(hiddenStatusIds([or], STATUSES).has("s-done")).toBe(false);
  });
});

describe("showsDone", () => {
  it("по умолчанию завершённые с сервера не нужны", () => {
    expect(showsDone([])).toBe(false);
  });

  it("«Готово = Показать» требует их догрузки", () => {
    expect(showsDone([group(["done", "is", SHOW_VALUE])])).toBe(true);
  });

  it("архив приходит и без флага: completed_at ему не проставляют", () => {
    expect(showsDone([group(["archive", "is", SHOW_VALUE])])).toBe(false);
  });
});
