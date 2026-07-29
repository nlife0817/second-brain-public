// Правило «Готово и Архив скрыты, пока их не выбрали фильтром» живёт в двух
// местах сразу — в отборе строк на экране и в решении, просить ли у сервера
// завершённые. Разъедутся они молча: список покажет пустоту вместо задач.

import { describe, expect, it } from "vitest";
import { hiddenStatusIds, needsCompletedTasks, type StatusKindRef } from "../views";
import type { FilterGroup } from "../views";

const STATUSES: StatusKindRef[] = [
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
  it("без фильтров прячет завершающие и архивные статусы", () => {
    expect([...hiddenStatusIds([], STATUSES)].sort()).toEqual(["s-archive", "s-done"]);
  });

  it("выбранный статус возвращается в список, остальные остаются скрытыми", () => {
    const hidden = hiddenStatusIds([group(["status", "is", "s-archive"])], STATUSES);
    expect(hidden.has("s-archive")).toBe(false);
    expect(hidden.has("s-done")).toBe(true);
  });

  it("«Завершена = Да» открывает завершающие статусы, но не архив", () => {
    const hidden = hiddenStatusIds([group(["completed", "is", "yes"])], STATUSES);
    expect(hidden.has("s-done")).toBe(false);
    expect(hidden.has("s-archive")).toBe(true);
  });

  it("«не равно» выбором не считается", () => {
    const hidden = hiddenStatusIds([group(["status", "is_not", "s-inbox"])], STATUSES);
    expect([...hidden].sort()).toEqual(["s-archive", "s-done"]);
  });

  it("рабочие статусы не прячет никогда", () => {
    const hidden = hiddenStatusIds([], STATUSES);
    expect(hidden.has("s-inbox")).toBe(false);
    expect(hidden.has("s-doing")).toBe(false);
  });
});

describe("needsCompletedTasks", () => {
  it("по умолчанию завершённые с сервера не нужны", () => {
    expect(needsCompletedTasks([], STATUSES)).toBe(false);
  });

  it("выбор завершающего статуса требует их догрузки", () => {
    expect(needsCompletedTasks([group(["status", "is", "s-done"])], STATUSES)).toBe(true);
  });

  it("«Завершена = Да» — тот же запрос другими словами", () => {
    expect(needsCompletedTasks([group(["completed", "is", "yes"])], STATUSES)).toBe(true);
  });

  it("архив приходит и без флага: completed_at ему не проставляют", () => {
    expect(needsCompletedTasks([group(["status", "is", "s-archive"])], STATUSES)).toBe(false);
  });
});
