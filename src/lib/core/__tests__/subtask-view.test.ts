// Порядок и отсев подзадач в карточке. Проверяется главным образом то, что
// легко сломать обратной правкой: пустая позиция уходит вниз, а не наверх;
// пустой фильтр значит «показать всё», а не «не показывать ничего»; чипы одного
// поля соединяются через ИЛИ, а разных — через И.

import { describe, expect, it } from "vitest";
import {
  EMPTY_SUBTASK_FILTERS,
  compareManual,
  filterSubtasks,
  sortSubtasks,
  subtaskFiltersActive,
} from "../subtask-view";
import { NONE_VALUE, type SortContext } from "../views";
import type { TaskListItem } from "../types";

function sub(over: Partial<TaskListItem> & { id: string }): TaskListItem {
  return {
    org_id: "o1",
    title: "Подзадача",
    status_id: null,
    priority: "none",
    start_date: null,
    start_time: null,
    due_date: null,
    due_time: null,
    planned_date: null,
    estimated_minutes: null,
    completed_at: null,
    parent_task_id: "parent",
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
    ...over,
  };
}

const CTX: SortContext = {
  statusPosition: new Map([
    ["s-todo", 1],
    ["s-doing", 2],
  ]),
  projectPosition: new Map(),
  projectName: new Map(),
};

const ids = (list: TaskListItem[]) => list.map((s) => s.id);

describe("ручной порядок", () => {
  it("идёт по позиции", () => {
    const list = [
      sub({ id: "c", subtask_position: 3 }),
      sub({ id: "a", subtask_position: 1 }),
      sub({ id: "b", subtask_position: 2 }),
    ];
    expect(ids(sortSubtasks(list, "manual", "asc", CTX))).toEqual(["a", "b", "c"]);
  });

  it("подзадачу без позиции ставит в конец, а не в начало", () => {
    // Так же её отдаёт сервер (NULLS LAST): позиции нет у всего, что завели до
    // миграции 0049, и всплытие такой строки наверх выглядело бы перестановкой,
    // которой никто не делал.
    const list = [sub({ id: "old" }), sub({ id: "a", subtask_position: 1 })];
    expect(ids([...list].sort(compareManual))).toEqual(["a", "old"]);
  });

  it("две строки без позиции разводит временем создания", () => {
    const list = [
      sub({ id: "late", created_at: "2026-07-02T00:00:00Z" }),
      sub({ id: "early", created_at: "2026-07-01T00:00:00Z" }),
    ];
    expect(ids([...list].sort(compareManual))).toEqual(["early", "late"]);
  });

  it("не трогает исходный массив", () => {
    const list = [sub({ id: "b", subtask_position: 2 }), sub({ id: "a", subtask_position: 1 })];
    sortSubtasks(list, "manual", "asc", CTX);
    expect(ids(list)).toEqual(["b", "a"]);
  });
});

describe("сортировка по полю", () => {
  it("по дедлайну, пустой срок — внизу при любом направлении", () => {
    const list = [
      sub({ id: "none" }),
      sub({ id: "late", due_date: "2026-08-10" }),
      sub({ id: "soon", due_date: "2026-08-01" }),
    ];
    expect(ids(sortSubtasks(list, "due_date", "asc", CTX))).toEqual(["soon", "late", "none"]);
    expect(ids(sortSubtasks(list, "due_date", "desc", CTX))).toEqual(["late", "soon", "none"]);
  });

  it("по приоритету: срочное выше", () => {
    const list = [sub({ id: "low", priority: "low" }), sub({ id: "urgent", priority: "urgent" })];
    expect(ids(sortSubtasks(list, "priority", "asc", CTX))).toEqual(["urgent", "low"]);
  });

  it("по статусу — позицией справочника, а не алфавитом", () => {
    const list = [sub({ id: "doing", status_id: "s-doing" }), sub({ id: "todo", status_id: "s-todo" })];
    expect(ids(sortSubtasks(list, "status", "asc", CTX))).toEqual(["todo", "doing"]);
  });
});

describe("фильтр", () => {
  const done = sub({ id: "done", completed_at: "2026-07-02T00:00:00Z", status_id: "s-doing" });
  const mine = sub({ id: "mine", assignees: [{ id: "u1", email: "u1@x", name: "У", avatar_url: null }] });
  const nobody = sub({ id: "nobody", priority: "urgent", status_id: "s-todo" });
  const list = [done, mine, nobody];

  it("пустой фильтр показывает всё", () => {
    expect(subtaskFiltersActive(EMPTY_SUBTASK_FILTERS)).toBe(false);
    expect(filterSubtasks(list, EMPTY_SUBTASK_FILTERS)).toBe(list);
  });

  it("скрывает завершённые", () => {
    const out = filterSubtasks(list, { ...EMPTY_SUBTASK_FILTERS, hideDone: true });
    expect(ids(out)).toEqual(["mine", "nobody"]);
  });

  it("значения одного поля соединяет через ИЛИ", () => {
    const out = filterSubtasks(list, { ...EMPTY_SUBTASK_FILTERS, statusIds: ["s-todo", "s-doing"] });
    expect(ids(out)).toEqual(["done", "nobody"]);
  });

  it("разные поля соединяет через И", () => {
    const out = filterSubtasks(list, {
      ...EMPTY_SUBTASK_FILTERS,
      statusIds: ["s-todo"],
      priorities: ["urgent"],
    });
    expect(ids(out)).toEqual(["nobody"]);
    expect(
      filterSubtasks(list, { ...EMPTY_SUBTASK_FILTERS, statusIds: ["s-doing"], priorities: ["urgent"] }),
    ).toEqual([]);
  });

  it("«без исполнителя» — это отдельное значение, а не отсутствие фильтра", () => {
    const out = filterSubtasks(list, { ...EMPTY_SUBTASK_FILTERS, assigneeIds: [NONE_VALUE] });
    expect(ids(out)).toEqual(["done", "nobody"]);
    expect(ids(filterSubtasks(list, { ...EMPTY_SUBTASK_FILTERS, assigneeIds: ["u1"] }))).toEqual(["mine"]);
  });
});
