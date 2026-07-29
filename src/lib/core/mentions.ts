// Упоминания участников: разбор разметки и рассылка уведомлений.
//
// Упоминание живёт в тексте как <span data-type="mention" data-id="<uuid>"
// data-label="Имя">@Имя</span>. Разметку задаёт расширение редактора
// (components/v2/editor/Mention.ts) — она уезжает в core.tasks.description и
// core.comments.body, то есть переживает обновление Tiptap, поэтому описана
// явно, а не взята из умолчаний пакета. Санитайзер её пропускает без правок:
// у span разрешены data-* атрибуты.

import type { TxContext } from "@/lib/sql";
import { notifyUsers } from "./events";

const SPAN_TAG = /<span\b[^>]*>/gi;
const MENTION_ID = /data-id="([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"/;

/**
 * Кого упомянули в разметке. Разбор идёт по уже очищенному санитайзером HTML:
 * он нормализует кавычки и вычищает всё, чего нет в allowlist, поэтому здесь
 * достаточно регулярного выражения — тащить парсер ради одного атрибута незачем.
 */
export function extractMentionIds(html: string | null | undefined): string[] {
  if (!html) return [];
  const out = new Set<string>();
  for (const [tag] of html.matchAll(SPAN_TAG)) {
    if (!tag.includes('data-type="mention"')) continue;
    const m = tag.match(MENTION_ID);
    if (m) out.add(m[1].toLowerCase());
  }
  return [...out];
}

/**
 * Только появившиеся упоминания. Описание автосохраняется раз в 1.2 секунды, и
 * без разницы с прошлой версией человек получал бы уведомление на каждую правку
 * абзаца, в котором его когда-то упомянули.
 */
export function newMentionIds(nextHtml: string, prevHtml: string | null | undefined): string[] {
  const before = new Set(extractMentionIds(prevHtml));
  return extractMentionIds(nextHtml).filter((id) => !before.has(id));
}

/**
 * Кто из перечисленных пользователей видит эту задачу — транспонированная
 * `filterVisibleTaskIds` из tasks.ts: там один пользователь и много задач, здесь
 * одна задача и много пользователей, и под второе `taskVisibility` не строится —
 * у него контекст зашит в параметры.
 *
 * Живёт здесь, а не рядом с оригиналом, чтобы не замыкать tasks.ts и mentions.ts
 * в кольцо импортов. Условия повторяют `loadTaskAccess` и `effectiveProjectRole`
 * — правя те, правь и это.
 */
export async function filterUsersWhoCanViewTask(
  tx: TxContext,
  orgId: string,
  taskId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const ph = userIds.map(() => "?").join(",");
  const rows = await tx
    .prepare<{ user_id: string }>(
      `WITH RECURSIVE chain AS (
         SELECT t.id, t.parent_task_id, t.created_by, 0 AS depth
         FROM core.tasks t WHERE t.id = ? AND t.org_id = ?
         UNION ALL
         SELECT p.id, p.parent_task_id, p.created_by, c.depth + 1
         FROM core.tasks p JOIN chain c ON p.id = c.parent_task_id
         WHERE c.depth < 8
       ),
       pl AS (
         SELECT tp.project_id, pr.default_role
         FROM core.task_projects tp
         JOIN core.projects pr ON pr.id = tp.project_id
         WHERE tp.task_id IN (SELECT id FROM chain)
       )
       SELECT m.user_id::text AS user_id
       FROM core.org_members m
       WHERE m.org_id = ? AND m.user_id IN (${ph}) AND (
             EXISTS (SELECT 1 FROM chain c WHERE c.created_by = m.user_id)
          OR EXISTS (SELECT 1 FROM core.task_assignees ta
                     WHERE ta.task_id IN (SELECT id FROM chain) AND ta.user_id = m.user_id)
          -- Подписка открывает только «свободную» задачу: иначе исключённый из
          -- проекта сохранял бы доступ навсегда, самоподписавшись (правило 4).
          OR (NOT EXISTS (SELECT 1 FROM pl)
              AND EXISTS (SELECT 1 FROM core.task_followers tf
                          WHERE tf.task_id IN (SELECT id FROM chain) AND tf.user_id = m.user_id))
          OR EXISTS (SELECT 1 FROM pl
                     JOIN core.project_members pm ON pm.project_id = pl.project_id
                     WHERE pm.user_id = m.user_id)
          -- default_role IS NOT NULL — открытый проект; гость базовой ролью
          -- не пользуется никогда.
          OR EXISTS (SELECT 1 FROM pl WHERE pl.default_role IS NOT NULL
                     AND m.role IN ('owner', 'admin', 'member'))
       )`,
    )
    .all(taskId, orgId, orgId, userIds);
  return rows.map((r) => r.user_id);
}

/**
 * Уведомить упомянутых. Возвращает тех, кому уведомление ушло: обычная аудитория
 * события обязана вычесть это множество, иначе упомянутый подписчик получит две
 * строки на одно событие — уникального ключа по (user_id, event_id) у
 * core.notifications нет.
 *
 * Упомянуть можно любого участника организации, но уведомление несёт с собой
 * название задачи: без фильтра видимости это дверь в закрытый проект.
 */
export async function notifyMentions(
  tx: TxContext,
  input: {
    orgId: string;
    eventId: number;
    taskId: string;
    actorId: string;
    html: string;
    /** Прошлая версия текста. Передаётся при правке — тогда шлём только новым. */
    prevHtml?: string | null;
  },
): Promise<Set<string>> {
  const ids =
    input.prevHtml !== undefined
      ? newMentionIds(input.html, input.prevHtml)
      : extractMentionIds(input.html);
  if (ids.length === 0) return new Set();

  const allowed = (await filterUsersWhoCanViewTask(tx, input.orgId, input.taskId, ids)).filter(
    (id) => id !== input.actorId,
  );
  if (allowed.length === 0) return new Set();

  await notifyUsers(tx, {
    orgId: input.orgId,
    eventId: input.eventId,
    kind: "mention",
    userIds: allowed,
    excludeUserId: input.actorId,
    taskId: input.taskId,
  });
  return new Set(allowed);
}
