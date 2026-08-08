// Черновик новой задачи — то, что набрано в строке добавления, но ещё не
// отправлено на сервер. Один и тот же объект показывают строчный ввод и
// развёрнутая карточка справа, поэтому форма черновика живёт отдельно от
// компонентов: переключение вида не должно ничего терять.

import { api } from "./client";
import type { TaskDetail, TaskPriority } from "./types";
import { todayIso } from "./views";

export interface TaskDraft {
  title: string;
  /** HTML — карточка хранит описание так же (Tiptap). */
  description: string;
  status_id: string | null;
  priority: TaskPriority;
  start_date: string | null;
  start_time: string | null;
  due_date: string | null;
  due_time: string | null;
  estimated_minutes: number | null;
  assignee_ids: string[];
  tag_ids: string[];
  /** Размещения (multi-homing). Пусто — задача уходит в личный инбокс. */
  project_ids: string[];
  /** Значения кастомных полей: API принимает их только после создания задачи. */
  field_values: Record<string, unknown>;
}

/**
 * Новый черновик: срок — сегодня, остальные поля пустые. `defaults` задаёт
 * экран: со страницы проекта задача обязана попасть в этот проект, иначе она
 * уедет в личный инбокс и пропадёт из списка, в котором её только что завели.
 */
export function emptyDraft(defaults?: Partial<TaskDraft>): TaskDraft {
  return {
    title: "",
    description: "",
    status_id: null,
    priority: "none",
    // Начало пустое, в отличие от срока: «когда начинаем» — осознанное решение,
    // а подставленное сегодня превратило бы гант в стену однодневных полос.
    start_date: null,
    start_time: null,
    due_date: todayIso(),
    due_time: null,
    estimated_minutes: null,
    assignee_ids: [],
    tag_ids: [],
    project_ids: [],
    field_values: {},
    ...defaults,
  };
}

/** Пустое значение поля — то, что не нужно отправлять на сервер. */
function isBlank(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** Тело POST /tasks. Время без даты схема не примет — снимаем его вместе с датой. */
export function draftToCreateBody(draft: TaskDraft): Record<string, unknown> {
  return {
    title: draft.title.trim(),
    description: draft.description || undefined,
    status_id: draft.status_id,
    priority: draft.priority,
    start_date: draft.start_date,
    start_time: draft.start_date ? draft.start_time : null,
    due_date: draft.due_date,
    due_time: draft.due_date ? draft.due_time : null,
    estimated_minutes: draft.estimated_minutes,
    placements: draft.project_ids.map((project_id) => ({ project_id })),
    assignee_ids: draft.assignee_ids,
    tag_ids: draft.tag_ids,
  };
}

/** Заполненные кастомные поля — их проставляем отдельными PUT после создания. */
export function draftFieldEntries(draft: TaskDraft): Array<[string, unknown]> {
  return Object.entries(draft.field_values).filter(([, value]) => !isBlank(value));
}

/**
 * Создание задачи из черновика: сама задача, следом — значения кастомных полей
 * (схема создания их не принимает).
 *
 * Отказ на поле не роняет всю операцию, а возвращается предупреждением: задача
 * к этому моменту уже создана, и если считать это ошибкой, черновик останется
 * в строке и человек нажмёт «Сохранить» второй раз — получив дубль вместо
 * недостающего значения поля.
 */
export async function createTaskFromDraft(
  orgId: string,
  draft: TaskDraft,
  extra?: Record<string, unknown>,
): Promise<{ task: TaskDetail; fieldsWarning: string | null }> {
  const task = await api.post<TaskDetail>(`/orgs/${orgId}/tasks`, {
    ...draftToCreateBody(draft),
    ...extra,
  });

  const failed: string[] = [];
  for (const [fieldId, value] of draftFieldEntries(draft)) {
    try {
      await api.put(`/orgs/${orgId}/tasks/${task.id}/fields/${fieldId}`, { value });
    } catch {
      failed.push(fieldId);
    }
  }

  return {
    task,
    fieldsWarning:
      failed.length > 0
        ? `Задача создана, но значения ${failed.length} доп. полей записать не удалось — задайте их в карточке.`
        : null,
  };
}

/**
 * В черновике есть что терять — то есть он отличается от того, каким его
 * открыли. Проставленные самим экраном значения (сегодняшняя дата, проект)
 * «грязным» его не делают: иначе кнопка «Очистить» висела бы над пустой строкой.
 */
export function isDraftFilled(draft: TaskDraft, defaults?: Partial<TaskDraft>): boolean {
  const base = emptyDraft(defaults);
  return (Object.keys(base) as Array<keyof TaskDraft>).some(
    (key) => JSON.stringify(draft[key]) !== JSON.stringify(base[key]),
  );
}
