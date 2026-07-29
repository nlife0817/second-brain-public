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

/**
 * Проект существует и лежит в организации, где состоит этот человек.
 * Без проверки чужой id давал бы 500 на нарушении внешнего ключа, а
 * существование чужого проекта не подтверждаем вовсе — как и везде в policy.
 */
export async function canMuteProject(userId: string, projectId: string): Promise<boolean> {
  const row = await prepare<{ ok: number }>(
    `SELECT 1 AS ok FROM core.projects p
     JOIN core.org_members m ON m.org_id = p.org_id AND m.user_id = ?
     WHERE p.id = ?`,
  ).get(userId, projectId);
  return !!row;
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
  // Один запрос, а не два: этот фильтр стоит на пути каждой мутации задачи, и
  // лишний поход в базу здесь оплачивается на каждом сохранении.
  const placeholders = userIds.map(() => "?").join(",");
  const rows = await tx
    .prepare<{ project_id: string; user_id: string | null }>(
      `SELECT tp.project_id::text AS project_id, pm.user_id::text AS user_id
       FROM core.task_projects tp
       LEFT JOIN core.project_mutes pm
         ON pm.project_id = tp.project_id AND pm.user_id IN (${placeholders})
       WHERE tp.task_id = ?`,
    )
    .all(userIds, taskId);
  if (rows.length === 0) return userIds; // задача вне проектов — заглушать нечем

  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  const byUser = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.user_id) continue;
    const set = byUser.get(row.user_id) ?? new Set<string>();
    set.add(row.project_id);
    byUser.set(row.user_id, set);
  }
  if (byUser.size === 0) return userIds;
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
