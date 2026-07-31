// Комментарии к задачам: добавление с fan-out, правка автором, мягкое удаление.

import { prepare, transaction } from "@/lib/sql";
import { sanitizeRichText } from "@/lib/sanitize";
import { currentActorSource } from "./actor-source-store";
import { emitEvent, notifyUsers, taskAudience } from "./events";
import { DomainError } from "./http";
import { notifyMentions } from "./mentions";
import { canOrg } from "./policy";
import { requireTaskAccess } from "./tasks";
import type { AuthContext, CoreComment } from "./types";

const COMMENT_SELECT = `
  SELECT c.id, c.org_id, c.entity_type, c.entity_id, c.author_id, c.author_label,
         c.body, c.created_at, c.edited_at, c.parent_id, c.source,
         u.id AS u_id, u.email AS u_email, u.name AS u_name, u.avatar_url AS u_avatar
  FROM core.comments c
  LEFT JOIN core.users u ON u.id = c.author_id`;

type CommentRow = Omit<CoreComment, "author"> & {
  u_id: string | null;
  u_email: string | null;
  u_name: string | null;
  u_avatar: string | null;
};

function mapComment(r: CommentRow): CoreComment {
  return {
    id: r.id,
    org_id: r.org_id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    author_id: r.author_id,
    author_label: r.author_label,
    body: r.body,
    created_at: r.created_at,
    edited_at: r.edited_at,
    parent_id: r.parent_id,
    source: r.source ?? null,
    author: r.u_id
      ? { id: r.u_id, email: r.u_email ?? "", name: r.u_name ?? "", avatar_url: r.u_avatar }
      : null,
  };
}

export async function listTaskComments(ctx: AuthContext, taskId: string): Promise<CoreComment[]> {
  await requireTaskAccess(ctx, taskId, "view");
  // Сортировка идёт по времени КОРНЯ обсуждения, а не по его id: id — это
  // gen_random_uuid(), Postgres сравнивает его побайтово, и лента выстраивалась
  // в случайном порядке. Ключи: когда начали обсуждение → какое именно
  // обсуждение (развести два корня, созданных в одну миллисекунду, чтобы их
  // ответы не перемешались) → время внутри обсуждения (корень раньше ответов).
  const rows = await prepare<CommentRow>(
    `${COMMENT_SELECT}
     LEFT JOIN core.comments root ON root.id = c.parent_id
     WHERE c.entity_type = 'task' AND c.entity_id = ? AND c.deleted_at IS NULL
     ORDER BY coalesce(root.created_at, c.created_at), coalesce(c.parent_id, c.id), c.created_at`,
  ).all(taskId);
  return rows.map(mapComment);
}

export async function addTaskComment(
  ctx: AuthContext,
  taskId: string,
  body: string,
  parentId: string | null = null,
): Promise<CoreComment> {
  await requireTaskAccess(ctx, taskId, "comment");
  const clean = sanitizeRichText(body);
  if (!clean.trim()) throw new DomainError(422, "Comment is empty");

  // Ответ на ответ приводится к корню: два уровня — это уже дерево, а дерево в
  // узкой колонке карточки нечитаемо (то же решение, что в core.doc_comments).
  let rootId: string | null = null;
  if (parentId) {
    const parent = await prepare<{
      id: string;
      parent_id: string | null;
      org_id: string;
      entity_type: string;
      entity_id: string;
      deleted_at: string | null;
    }>(
      `SELECT id, parent_id, org_id, entity_type, entity_id, deleted_at FROM core.comments WHERE id = ?`,
    ).get(parentId);
    if (
      !parent ||
      parent.org_id !== ctx.orgId ||
      parent.deleted_at ||
      parent.entity_type !== "task" ||
      parent.entity_id !== taskId
    ) {
      throw new DomainError(404, "Comment not found");
    }
    rootId = parent.parent_id ?? parent.id;
  }

  const commentId = await transaction(async (tx) => {
    const row = await tx
      .prepare<{ id: string }>(
        `INSERT INTO core.comments (org_id, entity_type, entity_id, author_id, body, parent_id, source)
         VALUES (?, 'task', ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(ctx.orgId, taskId, ctx.user.id, clean, rootId, currentActorSource());
    if (!row) throw new DomainError(500, "Failed to add comment");

    const eventId = await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "task",
      entityId: taskId,
      verb: "comment.added",
      payload: { comment_id: row.id, parent_id: rootId },
    });
    // Упомянутые получают своё уведомление и вычитаются из общей аудитории:
    // уникального ключа по (user_id, event_id) у core.notifications нет, и без
    // этого упомянутый подписчик получил бы две строки на одно событие.
    const mentioned = await notifyMentions(tx, {
      orgId: ctx.orgId,
      eventId,
      taskId,
      actorId: ctx.user.id,
      html: clean,
    });
    await notifyUsers(tx, {
      orgId: ctx.orgId,
      eventId,
      kind: "comment",
      userIds: (await taskAudience(tx, taskId)).filter((id) => !mentioned.has(id)),
      excludeUserId: ctx.user.id,
      taskId,
    });
    // Комментатор начинает следить за задачей (поведение Asana).
    await tx
      .prepare(`INSERT INTO core.task_followers (task_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .run(taskId, ctx.user.id);
    return row.id;
  });

  const row = await prepare<CommentRow>(`${COMMENT_SELECT} WHERE c.id = ?`).get(commentId);
  if (!row) throw new DomainError(500, "Comment vanished");
  return mapComment(row);
}

type CommentGuard = {
  author_id: string | null;
  org_id: string;
  entity_type: "task" | "project" | "client";
  entity_id: string;
  parent_id: string | null;
  deleted_at: string | null;
};

/** Комментарий доступен только вместе с сущностью, к которой он привязан. */
async function loadCommentForWrite(ctx: AuthContext, commentId: string): Promise<CommentGuard> {
  const existing = await prepare<CommentGuard>(
    `SELECT author_id, org_id, entity_type, entity_id, parent_id, deleted_at FROM core.comments WHERE id = ?`,
  ).get(commentId);
  if (!existing || existing.org_id !== ctx.orgId || existing.deleted_at) {
    throw new DomainError(404, "Comment not found");
  }
  if (existing.entity_type === "task") {
    await requireTaskAccess(ctx, existing.entity_id, "view");
  }
  return existing;
}

export async function editComment(ctx: AuthContext, commentId: string, body: string): Promise<CoreComment> {
  const existing = await loadCommentForWrite(ctx, commentId);
  if (existing.author_id !== ctx.user.id) throw new DomainError(403, "Only the author can edit a comment");

  const clean = sanitizeRichText(body);
  if (!clean.trim()) throw new DomainError(422, "Comment is empty");
  // Правка события не пишет, а уведомление вешать не на что — поэтому новые
  // упоминания, появившиеся при редактировании, не рассылаются. Это решение, а
  // не недосмотр: заводить второй путь уведомлений мимо core.events нельзя.
  await prepare(`UPDATE core.comments SET body = ?, edited_at = now() WHERE id = ?`).run(clean, commentId);
  const row = await prepare<CommentRow>(`${COMMENT_SELECT} WHERE c.id = ?`).get(commentId);
  if (!row) throw new DomainError(500, "Comment vanished");
  return mapComment(row);
}

export async function deleteComment(ctx: AuthContext, commentId: string): Promise<void> {
  const existing = await loadCommentForWrite(ctx, commentId);
  const isAuthor = existing.author_id === ctx.user.id;
  if (!isAuthor && !canOrg(ctx, "org.members.manage")) {
    throw new DomainError(403, "Only the author or an org admin can delete a comment");
  }
  if (existing.parent_id) {
    await prepare(`UPDATE core.comments SET deleted_at = now() WHERE id = ?`).run(commentId);
    return;
  }
  // Корень уносит с собой ответы: осиротевшая ветка в ленте выглядит разговором
  // с самим собой (так же поступает deleteDocComment).
  await prepare(
    `UPDATE core.comments SET deleted_at = now() WHERE (id = ? OR parent_id = ?) AND deleted_at IS NULL`,
  ).run(commentId, commentId);
}
