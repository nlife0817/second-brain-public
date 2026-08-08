// Сортировка и фильтр подзадач в карточке задачи — чистая модель.
//
// Отдельно от `views.ts` намеренно: там модель целого экрана (колонки, группы,
// именованные представления), а здесь — секция внутри карточки, где из всего
// этого осмысленны только порядок и отсев. Сравнение задач при этом общее
// (`compareTasks`): разойдись оно — «по дедлайну» означало бы в карточке и в
// таблице разные вещи.

import { compareTasks, NONE_VALUE, type SortContext, type SortDirection } from "./views";
import type { TaskListItem, TaskPriority } from "./types";

/**
 * Чем упорядочены подзадачи. `manual` — порядок, заданный перетаскиванием
 * (`subtask_position`); остальные значения — колонки общей сортировки.
 */
export type SubtaskSortColumn =
  | "manual"
  | "due_date"
  | "priority"
  | "status"
  | "title"
  | "estimated_minutes"
  | "created_at";

export const SUBTASK_SORT_LABELS: Record<SubtaskSortColumn, string> = {
  manual: "Вручную",
  due_date: "Дедлайн",
  priority: "Приоритет",
  status: "Статус",
  title: "Название",
  estimated_minutes: "Оценка",
  created_at: "Дата создания",
};

/** Порядок пунктов меню: сначала ручной, дальше по частоте использования. */
export const SUBTASK_SORT_COLUMNS: SubtaskSortColumn[] = [
  "manual",
  "due_date",
  "priority",
  "status",
  "title",
  "estimated_minutes",
  "created_at",
];

export interface SubtaskFilters {
  /** Пустой список — «не фильтруем», а не «ничего не показывать». */
  statusIds: string[];
  /** id участников; `NONE_VALUE` означает «без исполнителя». */
  assigneeIds: string[];
  priorities: TaskPriority[];
  /** Убрать завершённые из списка. Прогресс и счётчик считаются по всем. */
  hideDone: boolean;
}

export const EMPTY_SUBTASK_FILTERS: SubtaskFilters = {
  statusIds: [],
  assigneeIds: [],
  priorities: [],
  hideDone: false,
};

export function subtaskFiltersActive(filters: SubtaskFilters): boolean {
  return (
    filters.hideDone ||
    filters.statusIds.length > 0 ||
    filters.assigneeIds.length > 0 ||
    filters.priorities.length > 0
  );
}

/**
 * Отсев по фильтру. Условия разных полей соединяются через И, значения одного
 * поля — через ИЛИ: набор чипов читается как «покажи вот эти статусы», а не как
 * «покажи то, что одновременно во всех выбранных».
 */
export function filterSubtasks(subtasks: TaskListItem[], filters: SubtaskFilters): TaskListItem[] {
  if (!subtaskFiltersActive(filters)) return subtasks;
  return subtasks.filter((s) => {
    if (filters.hideDone && s.completed_at) return false;
    if (filters.statusIds.length > 0 && !(s.status_id && filters.statusIds.includes(s.status_id))) {
      return false;
    }
    if (filters.priorities.length > 0 && !filters.priorities.includes(s.priority)) return false;
    if (filters.assigneeIds.length > 0) {
      const matched = s.assignees.some((a) => filters.assigneeIds.includes(a.id));
      const noneWanted = filters.assigneeIds.includes(NONE_VALUE) && s.assignees.length === 0;
      if (!matched && !noneWanted) return false;
    }
    return true;
  });
}

/**
 * Ручной порядок: позиция, а при её отсутствии — время создания. Пустая позиция
 * бывает у подзадач, заведённых до миграции 0049, и уходит в конец — ровно так
 * же, как их отдаёт сервер.
 */
export function compareManual(a: TaskListItem, b: TaskListItem): number {
  const pa = a.subtask_position;
  const pb = b.subtask_position;
  if (pa != null && pb != null && pa !== pb) return pa - pb;
  if (pa == null && pb != null) return 1;
  if (pa != null && pb == null) return -1;
  return a.created_at.localeCompare(b.created_at);
}

/** Порядок списка. Исходный массив не трогаем: он приходит из состояния карточки. */
export function sortSubtasks(
  subtasks: TaskListItem[],
  column: SubtaskSortColumn,
  direction: SortDirection,
  ctx: SortContext,
): TaskListItem[] {
  if (column === "manual") return [...subtasks].sort(compareManual);
  return [...subtasks].sort((a, b) => compareTasks(a, b, { column, direction }, ctx));
}
