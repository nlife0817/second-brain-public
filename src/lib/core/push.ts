// Push-доставка уведомлений v2: один диспетчер и для cron-тика, и для
// мгновенной отправки после мутаций (after() в withOrg/withUser).
//
// Захват атомарный: пачка помечается dispatched_at в том же UPDATE, которым
// выбирается (FOR UPDATE SKIP LOCKED) — конкурирующие вызовы не продублируют
// отправку. Отметка ставится до отправки и при сбое не снимается: повторные
// попытки только копили бы очередь, инбокс в приложении — источник правды.

import { prepare } from "@/lib/sql";
import { sendWebPush, type PushPayload } from "@/lib/notifications/push";
import { plural } from "./plural";

/**
 * Окно склейки серии. Первое уведомление уходит мгновенно, следующие за ним в
 * пределах этого окна ждут — и уезжают одним сводным пушем на ближайшей
 * отправке (любая мутация или тик cron). Минута выбрана как компромисс:
 * достаточно, чтобы поймать шквал правок одной задачи, и незаметно для
 * одиночного уведомления.
 */
const COALESCE_WINDOW_SECONDS = 60;

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
  /** Настройка получателя: слать ли push по этому типу события. */
  push_enabled: boolean;
  /** Готовый текст напоминания; у событийных уведомлений пусто. */
  payload: { title?: string; body?: string } | null;
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

export interface PushDevice {
  id: string;
  /** Свой endpoint браузер знает сам и помечает устройство как текущее. */
  endpoint: string;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
}

/** Устройства пользователя для раздела уведомлений. */
export async function listUserDevices(userId: string): Promise<PushDevice[]> {
  return prepare<PushDevice>(
    `SELECT id::text AS id, endpoint, user_agent, created_at, updated_at
     FROM core.push_subscriptions
     WHERE user_id = ?
     ORDER BY updated_at DESC`,
  ).all(userId);
}

/**
 * Отписывает устройство по id. Владелец проверяется в самом DELETE: id из
 * чужого списка не должен ничего удалять.
 */
export async function removeUserDevice(userId: string, id: string): Promise<boolean> {
  const rows = await prepare<{ id: string }>(
    `DELETE FROM core.push_subscriptions
     WHERE id = ?::uuid AND user_id = ?
     RETURNING id::text AS id`,
  ).all(id, userId);
  return rows.length > 0;
}

/**
 * Проверочное уведомление на все устройства пользователя. Без него «включил,
 * но ничего не приходит» невозможно отличить от «всё работает, просто пока
 * нечему приходить»: между подпиской и первым реальным событием могут пройти
 * часы, а к тому моменту причину уже не найти.
 */
export async function sendTestPushToUser(
  userId: string,
): Promise<{ sent: number; removed: number }> {
  const targets = await listTargets(userId);
  let sent = 0;
  let removed = 0;
  for (const target of targets) {
    const mobile = isMobileUserAgent(target.user_agent);
    const result = await sendWebPush(target, {
      title: "Проверка уведомлений",
      body: "Если вы видите это сообщение — уведомления работают.",
      url: mobile ? "/v2/m/inbox" : "/v2/inbox",
      tag: "v2-test",
    });
    if (result === "sent") sent++;
    if (result === "dead") {
      await dropTarget(target);
      removed++;
    }
  }
  return { sent, removed };
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
  const url = taskUrl(row, mobile);
  // У напоминания нет автора и комментария: текст собран в reminders.ts, где
  // известны и число задач, и их названия.
  const reminder = row.payload as { title?: string; body?: string } | null;
  return {
    title: reminder?.title ?? KIND_TITLES[row.kind] ?? "Обновление",
    body: reminder?.body ?? body ?? "",
    url,
    // Тег по сущности, а не по уведомлению: пять комментариев к одной задаче
    // схлопываются в одно уведомление вместо пяти строк в шторке.
    tag: row.entity_id ? `v2-${row.entity_type}-${row.entity_id}` : `v2-${row.id}`,
    unread: row.unread,
  };
}

/** Заголовок сводного пуша по типу события и числу штук. */
function groupTitle(kind: string, count: number): string {
  switch (kind) {
    case "comment":
      return plural(count, "новый комментарий", "новых комментария", "новых комментариев");
    case "assigned":
      return plural(count, "новая задача", "новые задачи", "новых задач");
    case "status_changed":
      return plural(count, "смена статуса", "смены статуса", "смен статуса");
    default:
      return plural(count, "новое уведомление", "новых уведомления", "новых уведомлений");
  }
}

/**
 * Сводный пуш, когда за одну отправку у человека накопилось несколько
 * уведомлений: пять комментариев к одной задаче — это «5 новых комментариев»,
 * а не пять строк в шторке. Копятся они либо из-за окна склейки, либо из-за
 * тихих часов, когда отправка ждала утра.
 */
function buildGroupPayload(rows: PendingRow[], mobile: boolean): PushPayload {
  const unread = Math.max(...rows.map((r) => r.unread));
  const entityIds = new Set(rows.map((r) => r.entity_id).filter(Boolean));
  const kinds = new Set(rows.map((r) => r.kind));
  const first = rows[0];

  // Всё про одну задачу — тег тот же, что у одиночного пуша: сводка заменит
  // собой уже показанное уведомление, а не ляжет рядом с ним.
  if (entityIds.size === 1 && first.entity_id) {
    const title = kinds.size === 1 ? groupTitle(first.kind, rows.length) : groupTitle("", rows.length);
    const where = first.entity_title ? `«${first.entity_title}»` : "";
    return {
      title,
      body: where,
      url: taskUrl(first, mobile),
      tag: `v2-${first.entity_type}-${first.entity_id}`,
      unread,
    };
  }

  return {
    title: groupTitle(kinds.size === 1 ? first.kind : "", rows.length),
    body: "Откройте уведомления, чтобы посмотреть",
    url: mobile ? "/v2/m/inbox" : "/v2/inbox",
    tag: "v2-digest",
    unread,
  };
}

function taskUrl(row: PendingRow, mobile: boolean): string {
  if (row.entity_type === "task" && row.entity_id) {
    return mobile ? `/v2/m/my?task=${row.entity_id}` : `/v2/my?task=${row.entity_id}`;
  }
  if (row.entity_type === "project" && row.entity_id) {
    return mobile ? `/v2/m/projects/${row.entity_id}` : `/v2/projects/${row.entity_id}`;
  }
  return mobile ? "/v2/m/inbox" : "/v2/inbox";
}

/**
 * Рассылает push по неотправленным core.notifications. Безопасно звать
 * с любой частотой: пустая очередь — один быстрый UPDATE.
 *
 * Счётчики считают получателей, а не записи: несколько уведомлений одному
 * человеку — это один push.
 */
export async function dispatchPendingPush(): Promise<{ sent: number; skipped: number }> {
  const claimed = await prepare<{ id: string }>(
    `WITH pending AS (
       SELECT n.id FROM core.notifications n
       LEFT JOIN core.notification_settings ns ON ns.user_id = n.user_id
       WHERE n.dispatched_at IS NULL
         AND n.read_at IS NULL
         AND n.created_at > now() - interval '2 days'
         -- Тихие часы: строку не забираем вовсе, поэтому она уйдёт следующим
         -- тиком после их окончания — и уйдёт вместе с остальными, одним
         -- сводным пушем, а не очередью за ночь. Окно может пересекать
         -- полночь; условие повторяет isQuietNow из notification-settings.ts.
         AND NOT (
           coalesce(ns.quiet_enabled, false)
           AND ns.quiet_start <> ns.quiet_end
           AND CASE
                 WHEN ns.quiet_start < ns.quiet_end
                   THEN (now() AT TIME ZONE ns.timezone)::time >= ns.quiet_start
                    AND (now() AT TIME ZONE ns.timezone)::time <  ns.quiet_end
                 ELSE (now() AT TIME ZONE ns.timezone)::time >= ns.quiet_start
                   OR (now() AT TIME ZONE ns.timezone)::time <  ns.quiet_end
               END
         )
         -- Окно склейки: только что этому человеку уже уходил push, а этому
         -- уведомлению меньше минуты — значит идёт серия. Придержим: через
         -- минуту оно уедет вместе с остальными накопившимися одним сводным
         -- сообщением. Первое уведомление серии при этом уходит мгновенно.
         AND NOT (
           n.created_at > now() - ?::int * interval '1 second'
           AND EXISTS (
             SELECT 1 FROM core.notifications d
             WHERE d.user_id = n.user_id
               AND d.dispatched_at > now() - ?::int * interval '1 second'
           )
         )
       ORDER BY n.created_at
       LIMIT 100
       -- OF n обязательно: блокировать нечего на нулевой стороне LEFT JOIN,
       -- и без указания таблицы Postgres откажется выполнять запрос.
       FOR UPDATE OF n SKIP LOCKED
     )
     UPDATE core.notifications n
     SET dispatched_at = now()
     FROM pending
     WHERE n.id = pending.id
     RETURNING n.id::text AS id`,
  ).all(COALESCE_WINDOW_SECONDS, COALESCE_WINDOW_SECONDS);
  if (claimed.length === 0) return { sent: 0, skipped: 0 };

  const placeholders = claimed.map(() => "?").join(",");
  const rows = await prepare<PendingRow>(
    `SELECT n.id, n.kind, n.user_id, u.email, a.name AS actor_name, n.payload,
            coalesce(n.entity_type, e.entity_type) AS entity_type,
            coalesce(n.entity_id, e.entity_id)::text AS entity_id,
            CASE
              WHEN coalesce(n.entity_type, e.entity_type) = 'task'
                THEN (SELECT t.title FROM core.tasks t WHERE t.id = coalesce(n.entity_id, e.entity_id))
              WHEN coalesce(n.entity_type, e.entity_type) = 'project'
                THEN (SELECT p.name FROM core.projects p WHERE p.id = coalesce(n.entity_id, e.entity_id))
            END AS entity_title,
            CASE WHEN n.kind = 'comment' AND e.payload ->> 'comment_id' IS NOT NULL
                 THEN (SELECT c.body FROM core.comments c
                       WHERE c.id = (e.payload ->> 'comment_id')::uuid AND c.deleted_at IS NULL)
            END AS comment_html,
            (SELECT count(*)::int FROM core.notifications un
             WHERE un.user_id = n.user_id AND un.read_at IS NULL) AS unread,
            coalesce((SELECT np.push FROM core.notification_prefs np
                      WHERE np.user_id = n.user_id AND np.kind = n.kind), true) AS push_enabled
     FROM core.notifications n
     JOIN core.users u ON u.id = n.user_id
     LEFT JOIN core.events e ON e.id = n.event_id
     LEFT JOIN core.users a ON a.id = e.actor_id
     WHERE n.id IN (${placeholders})
     ORDER BY n.created_at`,
  ).all(claimed.map((c) => c.id));

  // Отправляем по получателю, а не по записи: у одного человека в пачке может
  // оказаться пять уведомлений, и это одно сообщение со сводкой.
  const byUser = new Map<string, PendingRow[]>();
  let skipped = 0;
  for (const row of rows) {
    // Тип выключён в настройках: запись в инбоксе остаётся, шторку не трогаем.
    if (!row.push_enabled) {
      skipped++;
      continue;
    }
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
  }

  let sent = 0;
  for (const [userId, userRows] of byUser) {
    try {
      const targets = await listTargets(userId);
      let delivered = 0;
      for (const target of targets) {
        const mobile = isMobileUserAgent(target.user_agent);
        const payload =
          userRows.length === 1 ? buildPayload(userRows[0], mobile) : buildGroupPayload(userRows, mobile);
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
