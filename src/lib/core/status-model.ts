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

/** Почему статус нельзя перенести в другую категорию; null — можно. */
export type StatusMoveBlock = "last_in_category" | "default_not_working" | null;

/**
 * Правило переноса статуса между категориями — перетаскиванием в настройках или
 * патчем `category`. Те же два запрета, что и у сервера: обязательная категория
 * не пустеет, статус по умолчанию остаётся рабочим.
 */
export function statusMoveBlock(
  statuses: TaskStatus[],
  statusId: string,
  next: StatusCategory,
): StatusMoveBlock {
  const target = statuses.find((s) => s.id === statusId);
  if (!target || target.category === next) return null;
  if (
    REQUIRED_CATEGORIES.includes(target.category) &&
    !statuses.some((s) => s.category === target.category && s.id !== statusId)
  ) {
    return "last_in_category";
  }
  if (target.is_default && !isWorkingCategory(next)) return "default_not_working";
  return null;
}

export function moveBlockMessage(
  block: Exclude<StatusMoveBlock, null>,
  from: StatusCategory,
): string {
  return block === "last_in_category"
    ? `В категории «${CATEGORY_LABELS[from]}» должен остаться хотя бы один статус`
    : "Статус по умолчанию должен оставаться рабочим — сначала назначьте другой";
}

/**
 * Что не так с новой раскладкой справочника целиком; null — всё в порядке.
 * Проверять раскладку, а не отдельный перенос, нужно там, где приходит сразу
 * весь порядок (перетаскивание в настройках): один перенос бывает законным, а
 * пара сразу — нет.
 */
export function arrangementError(
  next: Array<Pick<TaskStatus, "category" | "is_default">>,
): string | null {
  for (const category of REQUIRED_CATEGORIES) {
    if (!next.some((s) => s.category === category)) {
      return `В категории «${CATEGORY_LABELS[category]}» должен остаться хотя бы один статус`;
    }
  }
  const target = next.find((s) => s.is_default);
  if (target && !isWorkingCategory(target.category)) {
    return "Статус по умолчанию должен оставаться рабочим — сначала назначьте другой";
  }
  return null;
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
 * Статусы одного набора. Стор держит справочник организации целиком (у задачи
 * из двух проектов статус может быть из чужого набора), а экран сужает его до
 * своего рабочего процесса.
 *
 * `setId === null` — набор не выбран, показываем всё: так ведут себя сводный
 * список и личный инбокс, где проекта нет вовсе.
 */
export function statusesOfSet(statuses: TaskStatus[], setId: string | null): TaskStatus[] {
  if (!setId) return statuses;
  return statuses.filter((s) => s.set_id === setId);
}

/**
 * Колонки доски проекта: статусы его набора ПЛЮС те, что фактически встречаются
 * у задач. Второе обязательно: задача живёт сразу в нескольких проектах, а
 * статус у неё один — спрятать её из проекта, где она размещена, значит потерять
 * её из виду, ничего никуда не переместив. Набор решает, что показываем, а не
 * что запрещаем.
 */
export function boardStatuses(
  statuses: TaskStatus[],
  setId: string | null,
  presentStatusIds: Iterable<string>,
): TaskStatus[] {
  if (!setId) return statuses;
  const present = new Set(presentStatusIds);
  // Свои колонки идут первыми и в своём порядке — доска читается как рабочий
  // процесс проекта. Чужие статусы становятся хвостом: они не часть процесса, а
  // напоминание, что задача живёт ещё где-то.
  const own = statuses.filter((s) => s.set_id === setId);
  const foreign = statuses.filter((s) => s.set_id !== setId && present.has(s.id));
  return [...own, ...foreign];
}

/**
 * Список набора плюс текущий статус задачи, если он из чужого набора. Нужен
 * ровно там, где показывают выбор: спрятанный текущий статус читается как
 * «ничего не выбрано», а задача из двух проектов с разными процессами — это
 * норма, а не ошибка данных.
 */
export function withCurrent(statuses: TaskStatus[], current: TaskStatus | undefined): TaskStatus[] {
  if (!current || statuses.some((s) => s.id === current.id)) return statuses;
  return [...statuses, current];
}

/**
 * Ряд кнопок в карточке задачи: рабочий путь от первого статуса к последнему.
 * Архивные в него не входят — архивирование это отдельное действие, а не
 * следующий шаг работы. Исключение — статус самой задачи: без него ряд показал
 * бы «ничего не выбрано», и из архива было бы не выйти (то же и со статусом из
 * чужого набора — он приходит сюда уже отфильтрованным списком).
 */
export function cardStatuses(statuses: TaskStatus[], currentId: string | null): TaskStatus[] {
  const flow = statuses.filter((s) => s.category !== "archived");
  const current = currentId ? statuses.find((s) => s.id === currentId) : undefined;
  if (current && current.category === "archived") return [...flow, current];
  return flow;
}

/**
 * Куда отправляет кнопка «В архив» — первый архивный статус справочника.
 * `undefined` означает, что архива в организации нет вовсе (категории это
 * разрешено пустовать), и кнопку показывать нечем.
 */
export function archiveStatus(statuses: TaskStatus[]): TaskStatus | undefined {
  return statuses.find((s) => s.category === "archived");
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
