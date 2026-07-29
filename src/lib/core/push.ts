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
  /** Текст комментария — только для kind = 'comment'. */
  comment_html: string | null;
  unread: number;
};

type TargetRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
};

/** Устройства пользователя. */
async function listTargets(userId: string): Promise<TargetRow[]> {
  return prepare<TargetRow>(
    `SELECT id::text AS id, endpoint, p256dh, auth, user_agent
     FROM core.push_subscriptions WHERE user_id = ?`,
  ).all(userId);
}

function isMobileUserAgent(ua: string | null): boolean {
  return !!ua && /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
}

async function dropTarget(target: TargetRow): Promise<void> {
  await prepare(`DELETE FROM core.push_subscriptions WHERE id = ?`).run(target.id);
}

/** Комментарии хранятся как HTML — в уведомление идёт обычный текст. */
function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Полезная нагрузка пуша. Мобильной подписке отдаём мобильный URL напрямую
 * (без прыжка через UA-редирект в proxy — и мимо липкой cookie ?desktop),
 * десктопной — обычный экран v2.
 */
function buildPayload(row: PendingRow, mobile: boolean): PushPayload {
  const where = row.entity_title ? `«${row.entity_title}»` : "";
  // В уведомлении о комментарии главное — сам текст: «Иван · «Задача»» не
  // говорит ничего и заставляет открывать приложение ради одной строки.
  const comment = row.comment_html ? htmlToText(row.comment_html) : "";
  const body = comment
    ? clamp([row.actor_name, where].filter(Boolean).join(" в ") + (where || row.actor_name ? ": " : "") + comment, 180)
    : [row.actor_name, where].filter(Boolean).join(" · ");
  let url: string;
  if (row.entity_type === "task" && row.entity_id) {
    url = mobile ? `/v2/m/my?task=${row.entity_id}` : `/v2/my?task=${row.entity_id}`;
  } else if (row.entity_type === "project" && row.entity_id) {
    url = mobile ? `/v2/m/projects/${row.entity_id}` : `/v2/projects/${row.entity_id}`;
  } else {
    url = mobile ? "/v2/m/inbox" : "/v2/inbox";
  }
  return {
    title: KIND_TITLES[row.kind] ?? "Обновление",
    body: body || "Открыть задачу",
    url,
    // Тег по сущности, а не по уведомлению: пять комментариев к одной задаче
    // схлопываются в одно уведомление вместо пяти строк в шторке.
    tag: row.entity_id ? `v2-${row.entity_type}-${row.entity_id}` : `v2-${row.id}`,
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
            CASE WHEN n.kind = 'comment' AND e.payload ->> 'comment_id' IS NOT NULL
                 THEN (SELECT c.body FROM core.comments c
                       WHERE c.id = (e.payload ->> 'comment_id')::uuid AND c.deleted_at IS NULL)
            END AS comment_html,
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
      const targets = await listTargets(row.user_id);
      let delivered = 0;
      for (const target of targets) {
        const payload = buildPayload(row, isMobileUserAgent(target.user_agent));
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
