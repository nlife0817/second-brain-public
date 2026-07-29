// Правила справочника статусов: категории, статус по умолчанию, что можно
// удалить и куда переедут задачи удалённого статуса.
//
// Чистые функции без SQL — их зовёт и сервер (orgmeta.ts), и интерфейс (экран
// настроек, карточка задачи). Тот же приём, что у assignable.ts: источник
// истины — сервер, интерфейс повторяет правило, чтобы не рисовать кнопку,
// которая ответит 422.

import type { StatusCategory, TaskStatus } from "./types";

/** Порядок категорий = порядок ряда кнопок в карточке и блоков в настройках. */
export const STATUS_CATEGORIES: readonly StatusCategory[] = [
  "backlog",
  "in_progress",
  "done",
  "archived",
];

export const CATEGORY_LABELS: Record<StatusCategory, string> = {
  backlog: "Бэклог",
  in_progress: "В работе",
  done: "Завершено",
  archived: "Архив",
};

/**
 * Категории, которые не бывают пустыми. Архив сюда не входит: он не участвует
 * в обычной работе, и заставлять держать там статус незачем.
 */
export const REQUIRED_CATEGORIES: readonly StatusCategory[] = ["backlog", "in_progress", "done"];

/** Категории, куда попадает новая задача — и только они годятся в дефолт. */
export const WORKING_CATEGORIES: readonly StatusCategory[] = ["backlog", "in_progress"];

export function isWorkingCategory(category: StatusCategory): boolean {
  return WORKING_CATEGORIES.includes(category);
}

/** Почему статус нельзя удалить; null — можно. */
export type StatusDeleteBlock = "default" | "last_in_category" | null;

export function statusDeleteBlock(statuses: TaskStatus[], statusId: string): StatusDeleteBlock {
  const target = statuses.find((s) => s.id === statusId);
  if (!target) return null;
  if (target.is_default) return "default";
  if (!REQUIRED_CATEGORIES.includes(target.category)) return null;
  const siblings = statuses.filter((s) => s.category === target.category && s.id !== statusId);
  return siblings.length === 0 ? "last_in_category" : null;
}

export function deleteBlockMessage(block: Exclude<StatusDeleteBlock, null>, category: StatusCategory): string {
  return block === "default"
    ? "Статус по умолчанию удалить нельзя — сначала назначьте другой"
    : `В категории «${CATEGORY_LABELS[category]}» должен остаться хотя бы один статус`;
}

/**
 * Куда переедут задачи удаляемого статуса: сосед по категории, а если категории
 * не станет вовсе (архив) — статус по умолчанию.
 */
export function fallbackStatusId(statuses: TaskStatus[], statusId: string): string | null {
  const target = statuses.find((s) => s.id === statusId);
  if (!target) return null;
  const sibling = statuses.find((s) => s.category === target.category && s.id !== statusId);
  if (sibling) return sibling.id;
  return statuses.find((s) => s.is_default && s.id !== statusId)?.id ?? null;
}

/**
 * Ряд кнопок в карточке задачи: рабочий путь от первого статуса к последнему.
 * Архивные в него не входят — архивирование это отдельное действие, а не
 * следующий шаг работы. Исключение — статус самой задачи: без него ряд показал
 * бы «ничего не выбрано», и из архива было бы не выйти.
 */
export function cardStatuses(statuses: TaskStatus[], currentId: string | null): TaskStatus[] {
  const flow = statuses.filter((s) => s.category !== "archived");
  const current = currentId ? statuses.find((s) => s.id === currentId) : undefined;
  if (current && current.category === "archived") return [...flow, current];
  return flow;
}

/** Раскладка экрана настроек: все категории, в том числе пустой архив. */
export function groupByCategory(
  statuses: TaskStatus[],
): Array<{ category: StatusCategory; statuses: TaskStatus[] }> {
  return STATUS_CATEGORIES.map((category) => ({
    category,
    statuses: statuses.filter((s) => s.category === category),
  }));
}

/** Статус, в который встаёт новая задача. Fallback — первый по позиции. */
export function defaultStatus(statuses: TaskStatus[]): TaskStatus | undefined {
  return statuses.find((s) => s.is_default) ?? statuses.find((s) => isWorkingCategory(s.category));
}
