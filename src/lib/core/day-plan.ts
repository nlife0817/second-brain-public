// План дня: как «Мои задачи» раскладывают список по дате работы.
//
// Экран отвечает на два разных вопроса, и до появления `planned_date` умел
// только второй:
//   1. что я делаю сегодня — задачи, которые я на сегодня взял;
//   2. откуда это брать — задачи, у которых срок ещё не наступил.
// Поэтому разделов два: сначала план (просроченный, сегодня, завтра, дальше),
// затем «Без плана», разложенное по дедлайну.
//
// Чистая функция без React: тот же порядок нужен и десктопному экрану, и
// мобильному, а две копии правила означали бы, что на телефоне и на компьютере
// «сегодня» состоит из разных задач.

import { addDays } from "./days";
import type { TaskListItem } from "./types";

/** Смысл подсветки заголовка; в классы его переводит экран. */
export type SectionTone = "danger" | "warn" | "none";

/**
 * Что предлагает строка раздела одним нажатием:
 *  - `take` — взять задачу в сегодняшний план;
 *  - `move` — перенести сорванный план на сегодня;
 *  - `clear` — снять с плана (день перегружен — разгружаем);
 *  - `null` — ничего: у завершённых планировать нечего.
 */
export type PlanAction = "take" | "move" | "clear" | null;

export interface DaySection {
  key: string;
  title: string;
  tone: SectionTone;
  action: PlanAction;
  items: TaskListItem[];
}

export interface DayPlanOptions {
  today: string;
  /** Завтра приходит снаружи, а не считается здесь: у теста свой «сегодня». */
  tomorrow?: string;
  /** Показывать ли раздел завершённых — переключатель в шапке экрана. */
  showDone: boolean;
}

/**
 * Разделы экрана в порядке отрисовки. Пустые не возвращаются: заголовок без
 * строк читается как поломка, а не как «здесь пусто».
 *
 * Просроченный план идёт первым и отдельно от «Сегодня»: день, на который
 * задачу брали, прошёл, а задача жива — это главное, что список обязан сказать
 * утром. Автопереноса нет намеренно, поэтому у раздела есть действие «перенести
 * на сегодня»: перенос — решение человека, а не ночная работа планировщика,
 * иначе «переносил пятый день» ничем не отличалось бы от «взял сегодня».
 */
export function daySections(tasks: readonly TaskListItem[], opts: DayPlanOptions): DaySection[] {
  const { today, showDone } = opts;
  const tomorrow = opts.tomorrow ?? addDays(today, 1);

  const planOverdue: TaskListItem[] = [];
  const planToday: TaskListItem[] = [];
  const planTomorrow: TaskListItem[] = [];
  const planLater: TaskListItem[] = [];
  const dueOverdue: TaskListItem[] = [];
  const dueToday: TaskListItem[] = [];
  const dueAhead: TaskListItem[] = [];
  const noDate: TaskListItem[] = [];
  const done: TaskListItem[] = [];

  for (const t of tasks) {
    // Завершённые не участвуют в плане вовсе: их место — свой раздел внизу,
    // иначе вчерашняя закрытая задача висела бы в «Просрочен план».
    if (t.completed_at) {
      done.push(t);
      continue;
    }
    if (t.planned_date) {
      if (t.planned_date < today) planOverdue.push(t);
      else if (t.planned_date === today) planToday.push(t);
      else if (t.planned_date === tomorrow) planTomorrow.push(t);
      else planLater.push(t);
      continue;
    }
    if (!t.due_date) noDate.push(t);
    else if (t.due_date < today) dueOverdue.push(t);
    else if (t.due_date === today) dueToday.push(t);
    else dueAhead.push(t);
  }

  const sections: DaySection[] = [
    { key: "plan_overdue", title: "Просрочен план", tone: "danger", action: "move", items: planOverdue },
    { key: "plan_today", title: "Сегодня", tone: "warn", action: "clear", items: planToday },
    { key: "plan_tomorrow", title: "Завтра", tone: "none", action: "take", items: planTomorrow },
    { key: "plan_later", title: "Дальше в плане", tone: "none", action: "take", items: planLater },
    // Ниже — то, что ещё не взято в работу: отсюда и наполняют день.
    { key: "due_overdue", title: "Просрочено", tone: "danger", action: "take", items: dueOverdue },
    { key: "due_today", title: "Срок сегодня", tone: "warn", action: "take", items: dueToday },
    { key: "due_ahead", title: "Дедлайн впереди", tone: "none", action: "take", items: dueAhead },
    { key: "no_date", title: "Без срока", tone: "none", action: "take", items: noDate },
  ];
  if (showDone) {
    sections.push({ key: "done", title: "Завершённые", tone: "none", action: null, items: done });
  }
  return sections.filter((s) => s.items.length > 0);
}

/** Первый раздел «без плана» — перед ним экран рисует разделитель. */
export const UNPLANNED_FIRST_SECTION = "due_overdue";

/** Разделы плана — по ним считается «на сегодня взято N задач». */
const PLAN_SECTIONS = new Set(["plan_overdue", "plan_today"]);

/** Сколько задач стоит в работе на сегодня, считая сорванный план прошлых дней. */
export function todayLoad(sections: readonly DaySection[]): number {
  return sections.filter((s) => PLAN_SECTIONS.has(s.key)).reduce((n, s) => n + s.items.length, 0);
}
