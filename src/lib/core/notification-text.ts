// Строка уведомления в инбоксе. Общая для десктопного и мобильного экранов:
// два списка с разъехавшимися формулировками — это два разных приложения.

import { REMINDER_KINDS } from "./notification-kinds";
import type { CoreNotification } from "./types";

/** Что сделал автор события. Напоминаний здесь нет — у них автора не бывает. */
const ACTION_LABELS: Record<string, string> = {
  assigned: "назначил(а) вам задачу",
  comment: "прокомментировал(а)",
  mention: "упомянул(а) вас",
  status_changed: "сменил(а) статус",
  completed: "завершил(а) задачу",
  due_changed: "изменил(а) срок",
  added_to_project: "добавил(а) вас в проект",
  doc_comment: "прокомментировал(а) описание",
  doc_comment_resolved: "закрыл(а) обсуждение описания",
};

export interface NotificationLine {
  /** Автор действия; у напоминания его нет и подставлять «Кто-то» нельзя. */
  actor: string | null;
  action: string;
  /** Название задачи или проекта — выделяется в интерфейсе. */
  entity: string | null;
}

export function notificationLine(n: CoreNotification): NotificationLine {
  if (REMINDER_KINDS.has(n.kind)) {
    // Текст напоминания собран при создании: там были известны и число задач,
    // и их названия. Здесь его только показываем.
    const payload = (n.payload ?? {}) as { title?: string; body?: string };
    return {
      actor: null,
      action: payload.body || payload.title || "Напоминание о сроке",
      entity: null,
    };
  }
  return {
    actor: n.actor_name || "Кто-то",
    action: ACTION_LABELS[n.kind] ?? n.kind,
    entity: n.entity_title,
  };
}
