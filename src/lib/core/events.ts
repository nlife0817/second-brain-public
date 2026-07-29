// Событийная шина v2: каждая мутация пишет событие; уведомления раскладываются
// в той же транзакции (fan-out). Push-доставка — диспетчер в ./push.ts:
// after() в withOrg/withUser шлёт сразу после ответа, cron добирает остатки.

import { prepare, type TxContext } from "@/lib/sql";
import type { CoreEvent, CoreNotification } from "./types";

export type EntityType = "task" | "project" | "client" | "org";

export interface EmitInput {
  orgId: string;
  actorId: string | null;
  entityType: EntityType;
  entityId: string;
  verb: string;               // task.created, task.assigned, comment.added…
  payload?: Record<string, unknown>;
}

export async function emitEvent(tx: TxContext, e: EmitInput): Promise<number> {
  // events.id — bigint; postgres.js отдаёт его строкой, приводим к number,
  // чтобы сортировки и сравнения на клиенте не сравнивали "9" > "10".
  const row = await tx
    .prepare<{ id: string | number }>(
      `INSERT INTO core.events (org_id, actor_id, entity_type, entity_id, verb, payload)
       VALUES (?, ?, ?, ?, ?, ?::jsonb)
       RETURNING id`,
    )
    .get(e.orgId, e.actorId, e.entityType, e.entityId, e.verb, JSON.stringify(e.payload ?? {}));
  if (!row) throw new Error("emitEvent: insert failed");
  return Number(row.id);
}

/** Уведомления получателям (кроме автора действия), в той же транзакции. */
export async function notifyUsers(
  tx: TxContext,
  input: {
    orgId: string;
    eventId: number;
    kind: string;
    userIds: Iterable<string>;
    excludeUserId?: string | null;
  },
): Promise<void> {
  const targets = [...new Set(input.userIds)].filter((id) => id && id !== input.excludeUserId);
  for (const userId of targets) {
    await tx
      .prepare(
        `INSERT INTO core.notifications (org_id, user_id, event_id, kind) VALUES (?, ?, ?, ?)`,
      )
      .run(input.orgId, userId, input.eventId, input.kind);
  }
}

/** Аудитория задачи: создатель + исполнители + подписчики. */
export async function taskAudience(tx: TxContext, taskId: string): Promise<string[]> {
  const rows = await tx
    .prepare<{ user_id: string }>(
      `SELECT created_by AS user_id FROM core.tasks WHERE id = ? AND created_by IS NOT NULL
       UNION
       SELECT user_id FROM core.task_assignees WHERE task_id = ?
       UNION
       SELECT user_id FROM core.task_followers WHERE task_id = ?`,
    )
    .all(taskId, taskId, taskId);
  return rows.map((r) => r.user_id);
}

export async function listEntityFeed(
  entityType: EntityType,
  entityId: string,
  limit = 200,
): Promise<CoreEvent[]> {
  const rows = await prepare<CoreEvent & { actor_email: string | null; actor_name: string | null; actor_avatar: string | null }>(
    `SELECT e.id, e.org_id, e.actor_id, e.entity_type, e.entity_id, e.verb, e.payload, e.created_at,
            u.email AS actor_email, u.name AS actor_name, u.avatar_url AS actor_avatar
     FROM core.events e
     LEFT JOIN core.users u ON u.id = e.actor_id
     WHERE e.entity_type = ? AND e.entity_id = ?
     ORDER BY e.id DESC
     LIMIT ?`,
  ).all(entityType, entityId, limit);
  return rows.map((r) => ({
    id: Number(r.id),
    org_id: r.org_id,
    actor_id: r.actor_id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    verb: r.verb,
    payload: r.payload,
    created_at: r.created_at,
    actor: r.actor_id
      ? { id: r.actor_id, email: r.actor_email ?? "", name: r.actor_name ?? "", avatar_url: r.actor_avatar }
      : null,
  }));
}

export async function listNotifications(
  orgId: string,
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<CoreNotification[]> {
  return prepare<CoreNotification>(
    `SELECT n.id, n.org_id, n.kind, n.read_at, n.created_at,
            e.verb, e.payload, e.entity_type, e.entity_id,
            u.name AS actor_name,
            CASE
              WHEN e.entity_type = 'task' THEN (SELECT t.title FROM core.tasks t WHERE t.id = e.entity_id)
              WHEN e.entity_type = 'project' THEN (SELECT p.name FROM core.projects p WHERE p.id = e.entity_id)
            END AS entity_title,
            -- Своё/подписка/прочее: инбокс фильтрует и группирует по этому
            -- признаку, а в браузере ни исполнителей, ни подписок нет.
            CASE
              WHEN e.entity_type = 'task'
                   AND EXISTS (SELECT 1 FROM core.task_assignees ta
                               WHERE ta.task_id = e.entity_id AND ta.user_id = n.user_id)
                THEN 'mine'
              WHEN e.entity_type = 'task'
                   AND EXISTS (SELECT 1 FROM core.task_followers tf
                               WHERE tf.task_id = e.entity_id AND tf.user_id = n.user_id)
                THEN 'subscribed'
              ELSE 'other'
            END AS scope
     FROM core.notifications n
     LEFT JOIN core.events e ON e.id = n.event_id
     LEFT JOIN core.users u ON u.id = e.actor_id
     WHERE n.org_id = ? AND n.user_id = ?
       AND (?::boolean IS FALSE OR n.read_at IS NULL)
     ORDER BY n.created_at DESC
     LIMIT ?`,
  ).all(orgId, userId, opts.unreadOnly ?? false, opts.limit ?? 100);
}

export async function unreadNotificationCount(orgId: string, userId: string): Promise<number> {
  const row = await prepare<{ n: number }>(
    `SELECT count(*)::int AS n FROM core.notifications
     WHERE org_id = ? AND user_id = ? AND read_at IS NULL`,
  ).get(orgId, userId);
  return row?.n ?? 0;
}

export async function markNotificationsRead(
  orgId: string,
  userId: string,
  ids: string[] | "all",
): Promise<void> {
  if (ids === "all") {
    await prepare(
      `UPDATE core.notifications SET read_at = now()
       WHERE org_id = ? AND user_id = ? AND read_at IS NULL`,
    ).run(orgId, userId);
    return;
  }
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  await prepare(
    `UPDATE core.notifications SET read_at = now()
     WHERE org_id = ? AND user_id = ? AND read_at IS NULL AND id IN (${placeholders})`,
  ).run(orgId, userId, ids);
}
