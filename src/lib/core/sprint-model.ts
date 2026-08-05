// Правила спринта: переходы состояний, ёмкость, что делать со сроками задачи при
// переезде и куда девать незакрытые при завершении.
//
// Чистые функции без SQL — их зовёт и сервер (sprints.ts), и интерфейс (экран
// бэклога, диалоги старта и завершения). Тот же приём, что у status-model.ts:
// источник истины — сервер, интерфейс повторяет правило, чтобы показать итог
// заранее и не рисовать кнопку, которая ответит 422.

import { addDays, diffDays } from "./days";
import type { Sprint, SprintState, SprintWithTotals, StatusCategory } from "./types";

export const SPRINT_STATE_LABELS: Record<SprintState, string> = {
  planned: "Планируется",
  active: "Активный",
  completed: "Завершён",
};

/** Длительность спринта по умолчанию — две недели (14 дней включительно). */
export const DEFAULT_SPRINT_DAYS = 14;

// --- Переходы состояний ----------------------------------------------------------

/** Почему спринт нельзя начать; null — можно. */
export type SprintStartBlock = "not_planned" | "other_active" | null;

/**
 * Начать можно только запланированный спринт, и только когда в проекте нет
 * другого активного: «активный» отвечает на вопрос «над чем команда работает
 * сейчас», и двух ответов у него быть не может. Уникальный индекс в БД говорит
 * то же самое, но 23505 читать человеку нечем.
 */
export function sprintStartBlock(sprints: Sprint[], sprintId: string): SprintStartBlock {
  const target = sprints.find((s) => s.id === sprintId);
  if (!target) return null;
  if (target.state !== "planned") return "not_planned";
  const active = sprints.find((s) => s.state === "active" && s.id !== sprintId);
  return active ? "other_active" : null;
}

export function startBlockMessage(block: Exclude<SprintStartBlock, null>, activeName?: string): string {
  return block === "not_planned"
    ? "Начать можно только запланированный спринт"
    : `Сначала завершите «${activeName ?? "активный спринт"}» — активный спринт в проекте один`;
}

/** Завершить можно только активный спринт. */
export function canCompleteSprint(sprint: Pick<Sprint, "state">): boolean {
  return sprint.state === "active";
}

// --- Ёмкость ---------------------------------------------------------------------

export interface SprintLoad {
  /** Сумма оценок задач спринта, минуты. */
  minutes: number;
  capacity: number | null;
  /** Доля заполнения 0..1; null, когда ёмкость не задана. */
  ratio: number | null;
  over: boolean;
  /** Остаток ёмкости в минутах; null без ёмкости, 0 при перегрузе. */
  remaining: number | null;
}

export function sprintLoad(
  totals: Pick<SprintWithTotals, "estimated_minutes" | "capacity_minutes">,
): SprintLoad {
  const minutes = totals.estimated_minutes;
  const capacity = totals.capacity_minutes;
  if (!capacity) return { minutes, capacity: null, ratio: null, over: false, remaining: null };
  return {
    minutes,
    capacity,
    ratio: minutes / capacity,
    over: minutes > capacity,
    remaining: Math.max(0, capacity - minutes),
  };
}

/**
 * Сколько дней осталось до конца спринта, считая сегодняшний. `null` — конец не
 * задан, отрицательное значение — спринт просрочен и это надо показывать, а не
 * прятать за нулём.
 */
export function daysLeft(sprint: Pick<Sprint, "ends_on">, todayIso: string): number | null {
  if (!sprint.ends_on) return null;
  return diffDays(todayIso, sprint.ends_on) + 1;
}

// --- Даты задачи при переезде ------------------------------------------------------

type DateWindow = Pick<Sprint, "starts_on" | "ends_on">;
type TaskDates = { start_date: string | null; due_date: string | null };

/** Дата внутри окна спринта (границы включительно). Без окна — всегда false. */
export function isInsideSprint(date: string | null, sprint: DateWindow | null): boolean {
  if (!date || !sprint?.starts_on || !sprint.ends_on) return false;
  return date >= sprint.starts_on && date <= sprint.ends_on;
}

/**
 * Предлагать ли сдвиг сроков при переезде — то есть каким приходит состояние
 * галочки в диалоге.
 *
 * Правило: срок, стоявший ВНУТРИ старого спринта, выглядит как план команды и
 * едет вместе с задачей. Срок за его пределами похож на внешнее обязательство
 * («сдать заказчику 12-го»), и трогать его без спроса нельзя: due_date кормит
 * гант, календарь и напоминание исполнителю — молча сдвинуть его на две недели
 * значит молча отменить чужую договорённость.
 */
export function shouldShiftDates(task: TaskDates, from: DateWindow | null): boolean {
  if (!from) return false;
  return isInsideSprint(task.due_date, from) || isInsideSprint(task.start_date, from);
}

/** Сдвиг в днях между началами спринтов; 0, если начала неизвестны. */
export function sprintDelta(from: DateWindow | null, to: DateWindow | null): number {
  if (!from?.starts_on || !to?.starts_on) return 0;
  return diffDays(from.starts_on, to.starts_on);
}

/**
 * Новые сроки задачи при переезде из спринта `from` в спринт `to`.
 *
 * Сдвиг идёт ДЕЛЬТОЙ между началами спринтов, а не «на конец нового»: задача,
 * стоявшая на третий день итерации, останется на третьем. Если после сдвига
 * дата вылезает за конец нового спринта (спринты бывают разной длины) — она
 * прижимается к последнему дню, а не улетает за него.
 *
 * Переезд из бэклога (`from === null`) сроков не выдумывает: единственное, что
 * он делает по явной просьбе, — ставит срок на конец нового спринта задаче,
 * у которой срока не было.
 */
export function shiftTaskDates(task: TaskDates, from: DateWindow | null, to: DateWindow | null): TaskDates {
  if (!to) return { start_date: task.start_date, due_date: task.due_date };

  if (!from?.starts_on) {
    return {
      start_date: task.start_date,
      due_date: task.due_date ?? to.ends_on ?? null,
    };
  }

  const delta = sprintDelta(from, to);
  const move = (date: string | null): string | null => {
    if (!date) return null;
    const next = delta === 0 ? date : addDays(date, delta);
    if (to.ends_on && next > to.ends_on) return to.ends_on;
    if (to.starts_on && next < to.starts_on) return to.starts_on;
    return next;
  };
  return { start_date: move(task.start_date), due_date: move(task.due_date) };
}

/**
 * Конфликт, который показывают, когда сдвиг отключён: срок наступает раньше,
 * чем закончится спринт, — значит работа запланирована на после дедлайна.
 */
export function dueBeforeSprintEnd(task: TaskDates, to: DateWindow | null): boolean {
  if (!task.due_date || !to?.ends_on) return false;
  return task.due_date < to.ends_on;
}

// --- Завершение спринта --------------------------------------------------------------

/** Куда уходит незакрытая задача при завершении спринта. */
export type CarryTarget = "sprint" | "backlog";

/**
 * Умолчание для незакрытой задачи. Начатую (в работе, code review, QA — всё это
 * категория `in_progress`) берём в следующий спринт: прерывать идущую работу
 * бессмысленно. Не начатую возвращаем в бэклог — она не поместилась, и её место
 * в очереди должен решать приоритет, а не инерция.
 */
export function carryDefault(category: StatusCategory | undefined): CarryTarget {
  return category === "in_progress" ? "sprint" : "backlog";
}

// --- Черновик следующего спринта -------------------------------------------------------

export interface SprintDraft {
  name: string;
  starts_on: string;
  ends_on: string;
}

/**
 * Что подставить в форму нового спринта: продолжение предыдущего той же длины,
 * начиная со следующего дня. Имя — со следующим номером, если предыдущее им
 * заканчивалось. Форма нужна, только если что-то из этого не так.
 */
export function nextSprintDraft(previous: Sprint | undefined, todayIso: string): SprintDraft {
  const length =
    previous?.starts_on && previous.ends_on
      ? Math.max(1, diffDays(previous.starts_on, previous.ends_on) + 1)
      : DEFAULT_SPRINT_DAYS;
  const startsOn = previous?.ends_on ? addDays(previous.ends_on, 1) : todayIso;
  return {
    name: nextSprintName(previous?.name),
    starts_on: startsOn,
    ends_on: addDays(startsOn, length - 1),
  };
}

/** «Спринт 14» → «Спринт 15»; имя без номера получает « 2» в конце. */
export function nextSprintName(previous: string | undefined): string {
  if (!previous) return "Спринт 1";
  const match = previous.match(/^(.*?)(\d+)\s*$/);
  if (!match) return `${previous} 2`;
  return `${match[1]}${Number(match[2]) + 1}`;
}
