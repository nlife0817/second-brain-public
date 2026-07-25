// Push-доставка уведомлений v2: один диспетчер и для cron-тика, и для
// мгновенной отправки после мутаций (after() в withOrg/withUser).
//
// Захват атомарный: пачка помечается dispatched_at в том же UPDATE, которым
// выбирается (FOR UPDATE SKIP LOCKED) — конкурирующие вызовы не продублируют
// отправку. Отметка ставится до отправки и при сбое не снимается: повторные
// попытки только копили бы очередь, инбокс в приложении — источник правды.

import { prepare } from "@/lib/sql";
import { sendWebPush, type PushPayload } from "@/lib/notifications/push";

const KIND_TITLES: Record<string, string> = {
  assigned: "Вам назначили задачу",
  comment: "Новый комментарий",
  status_changed: "Статус изменён",
  completed: "Задача завершена",
  due_changed: "Срок изменён",
  added_to_project: "Вас добавили в проект",
};

type PendingRow = {
  id: string;
  kind: string;
  user_id: string;
  email: string;
  actor_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_title: string | null;
  unread: number;
};

type TargetRow = {
  id: string;
  src: "core" | "v1";
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Подписки пользователя: своя таблица core + наследие v1 по email (устройства,
 * подписанные до появления core.push_subscriptions). Дубли по endpoint
 * снимает вызывающий.
 */
async function listTargets(userId: string, email: string): Promise<TargetRow[]> {
  return prepare<TargetRow>(
    `SELECT id::text AS id, 'core' AS src, endpoint, p256dh, auth
     FROM core.push_subscriptions WHERE user_id = ?
     UNION ALL
     SELECT id, 'v1' AS src, endpoint, p256dh, auth
     FROM public.push_subscriptions WHERE user_email = ?`,
  ).all(userId, email);
}

async function dropTarget(target: TargetRow): Promise<void> {
  if (target.src === "core") {
    await prepare(`DELETE FROM core.push_subscriptions WHERE id = ?`).run(target.id);
  } else {
    await prepare(`DELETE FROM public.push_subscriptions WHERE id = ?`).run(target.id);
  }
}

function buildPayload(row: PendingRow): PushPayload {
  const body = [row.actor_name, row.entity_title && `«${row.entity_title}»`]
    .filter(Boolean)
    .join(" · ");
  // URL десктопный: для мобильных UA proxy сам переводит его на /v2/m/*.
  const url =
    row.entity_type === "task" && row.entity_id
      ? `/v2/my?task=${row.entity_id}`
      : row.entity_type === "project" && row.entity_id
        ? `/v2/projects/${row.entity_id}`
        : "/v2/inbox";
  return {
    title: KIND_TITLES[row.kind] ?? "Обновление",
    body: body || "Открыть задачу",
    url,
    tag: `v2-${row.id}`,
    unread: row.unread,
  };
}

/**
 * Рассылает push по неотправленным core.notifications. Безопасно звать
 * с любой частотой: пустая очередь — один быстрый UPDATE.
 */
export async function dispatchPendingPush(): Promise<{ sent: number; skipped: number }> {
  const claimed = await prepare<{ id: string }>(
    `WITH pending AS (
       SELECT id FROM core.notifications
       WHERE dispatched_at IS NULL
         AND read_at IS NULL
         AND created_at > now() - interval '2 days'
       ORDER BY created_at
       LIMIT 100
       FOR UPDATE SKIP LOCKED
     )
     UPDATE core.notifications n
     SET dispatched_at = now()
     FROM pending
     WHERE n.id = pending.id
     RETURNING n.id::text AS id`,
  ).all();
  if (claimed.length === 0) return { sent: 0, skipped: 0 };

  const placeholders = claimed.map(() => "?").join(",");
  const rows = await prepare<PendingRow>(
    `SELECT n.id, n.kind, n.user_id, u.email, a.name AS actor_name,
            e.entity_type, e.entity_id::text AS entity_id,
            CASE
              WHEN e.entity_type = 'task' THEN (SELECT t.title FROM core.tasks t WHERE t.id = e.entity_id)
              WHEN e.entity_type = 'project' THEN (SELECT p.name FROM core.projects p WHERE p.id = e.entity_id)
            END AS entity_title,
            (SELECT count(*)::int FROM core.notifications un
             WHERE un.user_id = n.user_id AND un.read_at IS NULL) AS unread
     FROM core.notifications n
     JOIN core.users u ON u.id = n.user_id
     LEFT JOIN core.events e ON e.id = n.event_id
     LEFT JOIN core.users a ON a.id = e.actor_id
     WHERE n.id IN (${placeholders})
     ORDER BY n.created_at`,
  ).all(claimed.map((c) => c.id));

  let sent = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      const targets = await listTargets(row.user_id, row.email);
      const payload = buildPayload(row);
      const seenEndpoints = new Set<string>();
      let delivered = 0;
      for (const target of targets) {
        if (seenEndpoints.has(target.endpoint)) continue;
        seenEndpoints.add(target.endpoint);
        const result = await sendWebPush(target, payload);
        if (result === "sent") delivered++;
        if (result === "dead") await dropTarget(target);
      }
      if (delivered > 0) sent++;
      else skipped++;
    } catch (err) {
      // Сюда попадает в основном отсутствие VAPID-ключей — без лога такая
      // конфигурация выглядела бы как «пуши молча не ходят».
      console.error("[v2/push] dispatch failed:", err);
      skipped++;
    }
  }
  return { sent, skipped };
}
