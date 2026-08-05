// Правила справочника статусов. Они живут в двух местах сразу — в сервисе
// (orgmeta.ts отдаёт 422) и в интерфейсе (кнопка гаснет с объяснением). Разойдутся
// молча: экран покажет кнопку, которая отвечает отказом.

import { describe, expect, it } from "vitest";
import {
  archiveStatus,
  boardStatuses,
  arrangementError,
  cardStatuses,
  defaultStatus,
  fallbackStatusId,
  groupByCategory,
  statusDeleteBlock,
  statusesOfSet,
  statusMoveBlock,
  withCurrent,
} from "../status-model";
import type { StatusCategory, TaskStatus } from "../types";

function status(
  id: string,
  category: StatusCategory,
  position: number,
  is_default = false,
): TaskStatus {
  return { id, org_id: "o1", set_id: "set1", name: id, color: "#000", category, is_default, position };
}

describe("наборы статусов", () => {
  const own = status("own", "in_progress", 1);
  const foreign: TaskStatus = { ...status("foreign", "in_progress", 1), set_id: "set2" };
  const all = [own, foreign];

  it("без набора показываем весь справочник — так живут инбокс и сводный список", () => {
    expect(statusesOfSet(all, null)).toEqual(all);
  });

  it("набор сужает список до своего процесса", () => {
    expect(statusesOfSet(all, "set1")).toEqual([own]);
  });

  it("доска добавляет чужой статус, если он есть у задач проекта", () => {
    // Задача живёт сразу в нескольких проектах, а статус у неё один: спрятать
    // её колонку значит потерять задачу из виду, ничего не переместив.
    expect(boardStatuses(all, "set1", ["foreign"])).toEqual(all);
    expect(boardStatuses(all, "set1", [])).toEqual([own]);
  });

  it("текущий статус задачи не пропадает из ряда карточки", () => {
    expect(withCurrent([own], foreign)).toEqual([own, foreign]);
    expect(withCurrent([own], own)).toEqual([own]);
    expect(withCurrent([own], undefined)).toEqual([own]);
  });
});

/** Сид организации: два бэклога, один «в работе», один «готово», один архив. */
const STATUSES: TaskStatus[] = [
  status("inbox", "backlog", 1),
  status("todo", "backlog", 2, true),
  status("doing", "in_progress", 3),
  status("done", "done", 4),
  status("archive", "archived", 5),
];

describe("statusDeleteBlock", () => {
  it("статус по умолчанию удалить нельзя", () => {
    expect(statusDeleteBlock(STATUSES, "todo")).toBe("default");
  });

  it("последний статус обязательной категории удалить нельзя", () => {
    expect(statusDeleteBlock(STATUSES, "doing")).toBe("last_in_category");
    expect(statusDeleteBlock(STATUSES, "done")).toBe("last_in_category");
  });

  it("второй статус категории удаляется", () => {
    expect(statusDeleteBlock(STATUSES, "inbox")).toBeNull();
  });

  it("единственный архивный удаляется: архиву разрешено пустовать", () => {
    expect(statusDeleteBlock(STATUSES, "archive")).toBeNull();
  });

  it("«по умолчанию» перевешивает «последний в категории»", () => {
    const one = [status("todo", "backlog", 1, true), status("doing", "in_progress", 2)];
    expect(statusDeleteBlock(one, "todo")).toBe("default");
  });
});

describe("statusMoveBlock", () => {
  it("перенос второго статуса категории разрешён", () => {
    expect(statusMoveBlock(STATUSES, "inbox", "in_progress")).toBeNull();
  });

  it("последний статус обязательной категории не уносят", () => {
    expect(statusMoveBlock(STATUSES, "doing", "backlog")).toBe("last_in_category");
  });

  it("единственный архивный уносят: архиву разрешено пустовать", () => {
    expect(statusMoveBlock(STATUSES, "archive", "done")).toBeNull();
  });

  it("статус по умолчанию не уезжает в нерабочую категорию", () => {
    expect(statusMoveBlock(STATUSES, "todo", "archived")).toBe("default_not_working");
  });

  it("перенос в свою же категорию — не перенос", () => {
    expect(statusMoveBlock(STATUSES, "doing", "in_progress")).toBeNull();
  });
});

describe("arrangementError", () => {
  it("сид организации проходит", () => {
    expect(arrangementError(STATUSES)).toBeNull();
  });

  it("опустевшая обязательная категория — отказ", () => {
    expect(arrangementError(STATUSES.filter((s) => s.category !== "done"))).toContain("Завершено");
  });

  it("пустой архив допустим", () => {
    expect(arrangementError(STATUSES.filter((s) => s.category !== "archived"))).toBeNull();
  });

  it("дефолт в нерабочей категории — отказ", () => {
    const moved = STATUSES.map((s) => (s.id === "todo" ? { ...s, category: "done" as const } : s));
    expect(arrangementError(moved)).toContain("по умолчанию");
  });
});

describe("fallbackStatusId", () => {
  it("задачи переезжают к соседу по категории", () => {
    expect(fallbackStatusId(STATUSES, "inbox")).toBe("todo");
  });

  it("из опустевшей категории — в статус по умолчанию", () => {
    expect(fallbackStatusId(STATUSES, "archive")).toBe("todo");
  });

  it("несуществующий статус переезда не требует", () => {
    expect(fallbackStatusId(STATUSES, "nope")).toBeNull();
  });
});

describe("cardStatuses", () => {
  it("архивные в ряд кнопок не попадают", () => {
    expect(cardStatuses(STATUSES, "todo").map((s) => s.id)).toEqual(["inbox", "todo", "doing", "done"]);
  });

  it("текущий архивный статус показывается в хвосте — иначе из архива не выйти", () => {
    expect(cardStatuses(STATUSES, "archive").map((s) => s.id)).toEqual([
      "inbox",
      "todo",
      "doing",
      "done",
      "archive",
    ]);
  });

  it("порядок кнопок — по позиции, а не по категории", () => {
    const mixed = [
      status("done", "done", 1),
      status("todo", "backlog", 2),
      status("doing", "in_progress", 3),
    ];
    expect(cardStatuses(mixed, null).map((s) => s.id)).toEqual(["done", "todo", "doing"]);
  });
});

describe("defaultStatus", () => {
  it("берёт помеченный флагом", () => {
    expect(defaultStatus(STATUSES)?.id).toBe("todo");
  });

  it("без флага откатывается на первый рабочий, а не на «Готово»", () => {
    const noFlag = [status("done", "done", 1), status("todo", "backlog", 2)];
    expect(defaultStatus(noFlag)?.id).toBe("todo");
  });
});

describe("archiveStatus", () => {
  it("кнопка «В архив» ведёт в первый архивный статус", () => {
    expect(archiveStatus(STATUSES)?.id).toBe("archive");
  });

  it("без архивных статусов кнопке некуда вести", () => {
    expect(archiveStatus(STATUSES.filter((s) => s.category !== "archived"))).toBeUndefined();
  });
});

describe("groupByCategory", () => {
  it("отдаёт все четыре категории, включая пустые", () => {
    const groups = groupByCategory([status("todo", "backlog", 1, true)]);
    expect(groups.map((g) => g.category)).toEqual(["backlog", "in_progress", "done", "archived"]);
    expect(groups.filter((g) => g.statuses.length === 0)).toHaveLength(3);
  });
});
