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
