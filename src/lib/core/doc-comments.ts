// Комментарии к тексту описания задачи: треды с ответами, правкой и закрытием.
//
// Отдельно от core.comments намеренно: обсуждение задачи плоское и не привязано
// к тексту, а здесь тред живёт на конкретном фрагменте описания. Якорь — mark
// <span data-comment="<thread_id>"> в HTML описания; сам фрагмент дублируется в
// колонке quote, чтобы правка текста не оставляла тред без опоры.

import { prepare, transaction, type TxContext } from "@/lib/sql";
import { sanitizeRichText } from "@/lib/sanitize";
import { emitEvent, notifyUsers, taskAudience } from "./events";
import { DomainError } from "./http";
import { canOrg } from "./policy";
import { requireTaskAccess } from "./tasks";
import type { AuthContext, DocCommentMessage, DocCommentThread } from "./types";

const MESSAGE_SELECT = `
  SELECT d.id, d.task_id, d.thread_id, d.parent_id, d.author_id, d.body, d.quote,
         d.resolved_at, d.resolved_by, d.created_at, d.edited_at,
         u.id AS u_id, u.email AS u_email, u.name AS u_name, u.avatar_url AS u_avatar
  FROM core.doc_comments d
  LEFT JOIN core.users u ON u.id = d.author_id`;

type MessageRow = {
  id: string;
  task_id: string;
  thread_id: string;
  parent_id: string | null;
  author_id: string | null;
  body: string;
  quote: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  edited_at: string | null;
  u_id: string | null;
  u_email: string | null;
  u_name: string | null;
  u_avatar: string | null;
};

function mapMessage(r: MessageRow): DocCommentMessage {
  return {
    id: r.id,
    author_id: r.author_id,
    body: r.body,
    created_at: r.created_at,
    edited_at: r.edited_at,
    author: r.u_id
      ? { id: r.u_id, email: r.u_email ?? "", name: r.u_name ?? "", avatar_url: r.u_avatar }
      : null,
  };
}

/** Строки одного треда → тред. Первая строка (она же корень) несёт quote и резолв. */
function groupThreads(rows: MessageRow[]): DocCommentThread[] {
  const byThread = new Map<string, MessageRow[]>();
  for (const row of rows) {
    const list = byThread.get(row.thread_id) ?? [];
    list.push(row);
    byThread.set(row.thread_id, list);
  }
  const threads: DocCommentThread[] = [];
  for (const [threadId, list] of byThread) {
    const root = list.find((r) => r.id === threadId) ?? list[0];
    threads.push({
      id: threadId,
      task_id: root.task_id,
      quote: root.quote,
      resolved_at: root.resolved_at,
      resolved_by: root.resolved_by,
      created_at: root.created_at,
      messages: list.map(mapMessage),
    });
  }
  // Порядок панели комментариев — порядок появления тредов в обсуждении.
  return threads.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function listDocComments(
  ctx: AuthContext,
  taskId: string,
): Promise<DocCommentThread[]> {
  await requireTaskAccess(ctx, taskId, "view");
  const rows = await prepare<MessageRow>(
    `${MESSAGE_SELECT}
     WHERE d.task_id = ? AND d.deleted_at IS NULL
     ORDER BY d.created_at`,
  ).all(taskId);
  return groupThreads(rows);
}

async function loadThread(ctx: AuthContext, taskId: string, threadId: string): Promise<DocCommentThread> {
  const rows = await prepare<MessageRow>(
    `${MESSAGE_SELECT}
     WHERE d.task_id = ? AND d.thread_id = ? AND d.deleted_at IS NULL
     ORDER BY d.created_at`,
  ).all(taskId, threadId);
  const [thread] = groupThreads(rows);
  if (!thread) throw new DomainError(404, "Обсуждение не найдено");
  return thread;
}

/** Кого оповестить: аудитория задачи плюс все, кто уже писал в этот тред. */
async function threadAudience(tx: TxContext, taskId: string, threadId: string): Promise<string[]> {
  const base = await taskAudience(tx, taskId);
  const rows = await tx
    .prepare<{ author_id: string }>(
      `SELECT DISTINCT author_id FROM core.doc_comments
       WHERE thread_id = ? AND author_id IS NOT NULL`,
    )
    .all(threadId);
  return [...base, ...rows.map((r) => r.author_id)];
}

function cleanBody(body: string): string {
  const clean = sanitizeRichText(body);
  if (!clean.trim()) throw new DomainError(422, "Комментарий пустой");
  return clean;
}

/** Новый тред на выделенном фрагменте. Возвращается целиком — панель рисует его сразу. */
export async function createDocThread(
  ctx: AuthContext,
  taskId: string,
  input: { body: string; quote: string },
): Promise<DocCommentThread> {
  await requireTaskAccess(ctx, taskId, "comment");
  const clean = cleanBody(input.body);
  // id треда совпадает с id корня и уходит в разметку описания, поэтому он
  // должен быть известен до вставки — иначе клиенту нечем пометить текст.
  const threadId = crypto.randomUUID();

  await transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO core.doc_comments (id, org_id, task_id, thread_id, author_id, body, quote)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(threadId, ctx.orgId, taskId, threadId, ctx.user.id, clean, input.quote.slice(0, 2000));

    const eventId = await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "task",
      entityId: taskId,
      verb: "doc_comment.added",
      payload: { thread_id: threadId, doc_comment_id: threadId },
    });
    await notifyUsers(tx, {
      orgId: ctx.orgId,
      eventId,
      kind: "doc_comment",
      userIds: await taskAudience(tx, taskId),
      excludeUserId: ctx.user.id,
    });
    // Как и обычный комментарий: обсуждающий начинает следить за задачей.
    await tx
      .prepare(`INSERT INTO core.task_followers (task_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .run(taskId, ctx.user.id);
  });

  return loadThread(ctx, taskId, threadId);
}

export async function replyToDocThread(
  ctx: AuthContext,
  taskId: string,
  threadId: string,
  body: string,
): Promise<DocCommentThread> {
  await requireTaskAccess(ctx, taskId, "comment");
  const root = await prepare<{ id: string; task_id: string }>(
    `SELECT id, task_id FROM core.doc_comments
     WHERE id = ? AND thread_id = ? AND org_id = ? AND deleted_at IS NULL`,
  ).get(threadId, threadId, ctx.orgId);
  if (!root || root.task_id !== taskId) throw new DomainError(404, "Обсуждение не найдено");
  const clean = cleanBody(body);

  const replyId = crypto.randomUUID();
  await transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO core.doc_comments (id, org_id, task_id, thread_id, parent_id, author_id, body)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(replyId, ctx.orgId, taskId, threadId, threadId, ctx.user.id, clean);

    const eventId = await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "task",
      entityId: taskId,
      verb: "doc_comment.replied",
      payload: { thread_id: threadId, doc_comment_id: replyId },
    });
    await notifyUsers(tx, {
      orgId: ctx.orgId,
      eventId,
      kind: "doc_comment",
      userIds: await threadAudience(tx, taskId, threadId),
      excludeUserId: ctx.user.id,
    });
    await tx
      .prepare(`INSERT INTO core.task_followers (task_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .run(taskId, ctx.user.id);
  });

  return loadThread(ctx, taskId, threadId);
}

type MessageGuard = {
  id: string;
  org_id: string;
  task_id: string;
  thread_id: string;
  author_id: string | null;
  deleted_at: string | null;
};

/** Сообщение доступно только вместе с задачей, к описанию которой оно привязано. */
async function loadMessageForWrite(ctx: AuthContext, commentId: string): Promise<MessageGuard> {
  const row = await prepare<MessageGuard>(
    `SELECT id, org_id, task_id, thread_id, author_id, deleted_at
     FROM core.doc_comments WHERE id = ?`,
  ).get(commentId);
  if (!row || row.org_id !== ctx.orgId || row.deleted_at) {
    throw new DomainError(404, "Комментарий не найден");
  }
  await requireTaskAccess(ctx, row.task_id, "view");
  return row;
}

export async function editDocComment(
  ctx: AuthContext,
  commentId: string,
  body: string,
): Promise<DocCommentThread> {
  const existing = await loadMessageForWrite(ctx, commentId);
  if (existing.author_id !== ctx.user.id) {
    throw new DomainError(403, "Править комментарий может только автор");
  }
  const clean = cleanBody(body);
  await prepare(`UPDATE core.doc_comments SET body = ?, edited_at = now() WHERE id = ?`).run(
    clean,
    commentId,
  );
  return loadThread(ctx, existing.task_id, existing.thread_id);
}

/**
 * Закрыть или переоткрыть тред. Закрывает автор треда либо тот, кто может
 * править задачу: обсуждение — часть документа, а не личная переписка автора.
 */
export async function setDocThreadResolved(
  ctx: AuthContext,
  threadId: string,
  resolved: boolean,
): Promise<DocCommentThread> {
  const root = await loadMessageForWrite(ctx, threadId);
  if (root.thread_id !== root.id) throw new DomainError(422, "Закрывается тред целиком");
  if (root.author_id !== ctx.user.id) {
    await requireTaskAccess(ctx, root.task_id, "edit");
  }

  await transaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE core.doc_comments
         SET resolved_at = ?, resolved_by = ?
         WHERE id = ?`,
      )
      .run(resolved ? new Date().toISOString() : null, resolved ? ctx.user.id : null, threadId);

    // Событие пишем в обе стороны: лента задачи должна объяснять, почему
    // обсуждение исчезло из панели.
    const eventId = await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "task",
      entityId: root.task_id,
      verb: resolved ? "doc_comment.resolved" : "doc_comment.reopened",
      payload: { thread_id: threadId },
    });
    if (resolved) {
      await notifyUsers(tx, {
        orgId: ctx.orgId,
        eventId,
        kind: "doc_comment_resolved",
        userIds: await threadAudience(tx, root.task_id, threadId),
        excludeUserId: ctx.user.id,
      });
    }
  });

  return loadThread(ctx, root.task_id, threadId);
}

/**
 * Мягкое удаление. Снос корня уносит тред целиком: ответы без вопроса
 * бессмысленны, а якорь в тексте всё равно исчезает вместе с ним.
 */
export async function deleteDocComment(ctx: AuthContext, commentId: string): Promise<void> {
  const existing = await loadMessageForWrite(ctx, commentId);
  const isAuthor = existing.author_id === ctx.user.id;
  if (!isAuthor && !canOrg(ctx, "org.members.manage")) {
    throw new DomainError(403, "Удалить комментарий может автор или администратор");
  }
  if (existing.id === existing.thread_id) {
    await prepare(
      `UPDATE core.doc_comments SET deleted_at = now() WHERE thread_id = ? AND deleted_at IS NULL`,
    ).run(existing.thread_id);
    return;
  }
  await prepare(`UPDATE core.doc_comments SET deleted_at = now() WHERE id = ?`).run(commentId);
}
