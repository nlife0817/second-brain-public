// Правила справочника статусов. Они живут в двух местах сразу — в сервисе
// (orgmeta.ts отдаёт 422) и в интерфейсе (кнопка гаснет с объяснением). Разойдутся
// молча: экран покажет кнопку, которая отвечает отказом.

import { describe, expect, it } from "vitest";
import {
  cardStatuses,
  defaultStatus,
  fallbackStatusId,
  groupByCategory,
  statusDeleteBlock,
} from "../status-model";
import type { StatusCategory, TaskStatus } from "../types";

function status(
  id: string,
  category: StatusCategory,
  position: number,
  is_default = false,
): TaskStatus {
  return { id, org_id: "o1", name: id, color: "#000", category, is_default, position };
}

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

describe("groupByCategory", () => {
  it("отдаёт все четыре категории, включая пустые", () => {
    const groups = groupByCategory([status("todo", "backlog", 1, true)]);
    expect(groups.map((g) => g.category)).toEqual(["backlog", "in_progress", "done", "archived"]);
    expect(groups.filter((g) => g.statuses.length === 0)).toHaveLength(3);
  });
});
