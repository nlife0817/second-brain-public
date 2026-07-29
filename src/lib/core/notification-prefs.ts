// Настройки уведомлений по типам событий (таблица core.notification_prefs).
//
// Отсутствие строки — «включено». Поэтому чтение всегда идёт через
// withDefaults(), а запись пишет строку только тогда, когда пользователь
// действительно что-то менял.

import { prepare, type TxContext } from "@/lib/sql";
import {
  NOTIFICATION_KINDS,
  withDefaults,
  type NotificationPref,
  type NotificationPrefs,
} from "./notification-kinds";

const KNOWN_KINDS = new Set(NOTIFICATION_KINDS.map((k) => k.kind));

export function isKnownKind(kind: string): boolean {
  return KNOWN_KINDS.has(kind);
}

export async function getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const rows = await prepare<{ kind: string; inbox: boolean; push: boolean }>(
    `SELECT kind, inbox, push FROM core.notification_prefs WHERE user_id = ?`,
  ).all(userId);
  const stored: NotificationPrefs = {};
  for (const row of rows) stored[row.kind] = { inbox: row.inbox, push: row.push };
  return withDefaults(stored);
}

export async function setNotificationPref(
  userId: string,
  kind: string,
  pref: NotificationPref,
): Promise<void> {
  // Выключенный инбокс делает push бессмысленным: уведомление не создаётся,
  // рассылать нечего. Приводим к согласованному виду здесь, чтобы диспетчер
  // не гадал по двум флагам.
  const push = pref.inbox && pref.push;
  await prepare(
    `INSERT INTO core.notification_prefs (user_id, kind, inbox, push)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, kind) DO UPDATE SET
       inbox = EXCLUDED.inbox,
       push = EXCLUDED.push,
       updated_at = now()`,
  ).run(userId, kind, pref.inbox, push);
}

// ---- Отключение по проекту -----------------------------------------------------------------

/**
 * Правило заглушения для задачи. Задача может лежать сразу в нескольких
 * проектах: молчим, только если заглушены все — иначе тихий проект отнимал бы
 * уведомления у остальных. Задача без проектов (личная) не заглушается ничем.
 *
 * Чистая функция: её одинаково применяют fan-out уведомлений и напоминания,
 * и разъехаться этим двум путям нельзя.
 */
export function isTaskMuted(projectIds: string[], mutedProjects: Set<string> | undefined): boolean {
  if (!mutedProjects || mutedProjects.size === 0) return false;
  if (projectIds.length === 0) return false;
  return projectIds.every((id) => mutedProjects.has(id));
}

export async function listMutedProjects(userId: string): Promise<string[]> {
  const rows = await prepare<{ project_id: string }>(
    `SELECT project_id::text AS project_id FROM core.project_mutes WHERE user_id = ?`,
  ).all(userId);
  return rows.map((r) => r.project_id);
}

export async function setProjectMute(
  userId: string,
  projectId: string,
  muted: boolean,
): Promise<void> {
  if (muted) {
    await prepare(
      `INSERT INTO core.project_mutes (user_id, project_id) VALUES (?, ?)
       ON CONFLICT (user_id, project_id) DO NOTHING`,
    ).run(userId, projectId);
    return;
  }
  await prepare(`DELETE FROM core.project_mutes WHERE user_id = ? AND project_id = ?`).run(
    userId,
    projectId,
  );
}

/**
 * Отсеивает получателей, заглушивших проекты задачи. Вызывается там же, где
 * фильтр по типам, — до записи в инбокс: заглушённый проект не должен
 * оставлять следов ни в списке, ни в счётчике.
 */
export async function filterByProjectMute(
  tx: TxContext,
  taskId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return userIds;
  const projects = await tx
    .prepare<{ project_id: string }>(
      `SELECT project_id::text AS project_id FROM core.task_projects WHERE task_id = ?`,
    )
    .all(taskId);
  if (projects.length === 0) return userIds;

  const placeholders = userIds.map(() => "?").join(",");
  const mutes = await tx
    .prepare<{ user_id: string; project_id: string }>(
      `SELECT user_id::text AS user_id, project_id::text AS project_id
       FROM core.project_mutes WHERE user_id IN (${placeholders})`,
    )
    .all(userIds);
  if (mutes.length === 0) return userIds;

  const byUser = new Map<string, Set<string>>();
  for (const mute of mutes) {
    const set = byUser.get(mute.user_id) ?? new Set<string>();
    set.add(mute.project_id);
    byUser.set(mute.user_id, set);
  }
  const projectIds = projects.map((p) => p.project_id);
  return userIds.filter((id) => !isTaskMuted(projectIds, byUser.get(id)));
}

/**
 * Отсеивает получателей, выключивших этот тип в инбоксе. Работает внутри той
 * же транзакции, что и fan-out: настройка, изменённая параллельно, не должна
 * приводить к половинчатой рассылке.
 */
export async function filterByInboxPref(
  tx: TxContext,
  kind: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return userIds;
  const placeholders = userIds.map(() => "?").join(",");
  const off = await tx
    .prepare<{ user_id: string }>(
      `SELECT user_id FROM core.notification_prefs
       WHERE kind = ? AND inbox = false AND user_id IN (${placeholders})`,
    )
    .all(kind, userIds);
  if (off.length === 0) return userIds;
  const excluded = new Set(off.map((r) => r.user_id));
  return userIds.filter((id) => !excluded.has(id));
}
