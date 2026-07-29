// Каталог типов уведомлений. Файл без импортов и без доступа к БД — его
// одинаково берут и серверный слой (events.ts, push.ts), и экраны настроек.
//
// Добавляя новый kind в notifyUsers, добавь его и сюда: иначе тип будет
// приходить, но управлять им из настроек будет нельзя.

export interface NotificationKindMeta {
  kind: string;
  /** Заголовок строки в настройках. */
  label: string;
  /** Когда именно приходит — иначе «Статус изменён» ничего не объясняет. */
  hint: string;
}

export const NOTIFICATION_KINDS: NotificationKindMeta[] = [
  {
    kind: "assigned",
    label: "Назначили задачу",
    hint: "Вас добавили исполнителем — новой задачи или уже существующей",
  },
  {
    kind: "comment",
    label: "Новый комментарий",
    hint: "Комментарий в задаче, где вы автор, исполнитель или подписчик",
  },
  {
    kind: "mention",
    label: "Упоминание",
    hint: "Вас назвали через @ в описании задачи или в комментарии",
  },
  {
    kind: "status_changed",
    label: "Статус изменён",
    hint: "Задачу передвинули по доске",
  },
  {
    kind: "completed",
    label: "Задача завершена",
    hint: "Задачу перевели в завершающий статус",
  },
  {
    kind: "due_changed",
    label: "Изменён срок",
    hint: "У задачи сдвинули дату или время дедлайна",
  },
  {
    kind: "added_to_project",
    label: "Добавили в проект",
    hint: "Вас включили в состав участников проекта",
  },
  {
    kind: "due_soon",
    label: "Скоро срок",
    hint: "За полчаса до времени, указанного в задаче",
  },
  {
    kind: "overdue",
    label: "Срок прошёл",
    hint: "Один раз по каждой просроченной задаче, а не ежечасно",
  },
  {
    kind: "digest",
    label: "Утренняя сводка",
    hint: "Что сегодня со сроком и что просрочено — одним сообщением",
  },
];

/**
 * Типы, которые рождаются не из чужого действия, а из наступившего времени.
 * Их поставляет lib/core/reminders.ts; у уведомления нет автора, и списки
 * не должны подставлять к ним «Кто-то».
 */
export const REMINDER_KINDS = new Set(["due_soon", "overdue", "digest"]);

export interface NotificationPref {
  /** Показывать в инбоксе. Выключено — событие не попадёт и в push. */
  inbox: boolean;
  /** Слать push на подписанные устройства. */
  push: boolean;
}

export type NotificationPrefs = Record<string, NotificationPref>;

export const DEFAULT_PREF: NotificationPref = { inbox: true, push: true };

/** Полный набор настроек: отсутствующие строки — значения по умолчанию. */
export function withDefaults(stored: NotificationPrefs): NotificationPrefs {
  const out: NotificationPrefs = {};
  for (const { kind } of NOTIFICATION_KINDS) {
    out[kind] = stored[kind] ?? DEFAULT_PREF;
  }
  return out;
}
