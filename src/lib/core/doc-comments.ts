// Комментарии к тексту: треды с ответами, правкой и закрытием.
//
// Владелец — описание задачи ИЛИ документ базы знаний (`DocOwner`): редактор у
// них общий, значит общими должны быть и обсуждения к фрагментам. Ветвление
// «задача или документ» собрано в doc-owner.ts, здесь его почти не видно.
//
// Отдельно от core.comments намеренно: обсуждение задачи плоское и не привязано
// к тексту, а здесь тред живёт на конкретном фрагменте. Якорь — mark
// <span data-comment="<thread_id>"> в HTML; сам фрагмент дублируется в колонке
// quote, чтобы правка текста не оставляла тред без опоры.

import { prepare, transaction, type TxContext } from "@/lib/sql";
import { sanitizeRichText } from "@/lib/sanitize";
import { emitEvent, notifyUsers } from "./events";
import {
  docOwnerAudience,
  docOwnerOf,
  ownerColumns,
  ownerEntity,
  requireDocOwner,
} from "./doc-owner";
import { DomainError } from "./http";
import { notifyMentions } from "./mentions";
import { canOrg } from "./policy";
import type { AuthContext, DocCommentMessage, DocCommentThread, DocOwner } from "./types";

/** Условие «этого владельца» одной строкой: колонка своя у задачи и документа. */
function ownerWhere(owner: DocOwner): { sql: string; value: string } {
  return owner.kind === "task"
    ? { sql: "d.task_id = ?", value: owner.taskId }
    : { sql: "d.document_id = ?", value: owner.documentId };
}

const MESSAGE_SELECT = `
  SELECT d.id, d.task_id, d.document_id, d.thread_id, d.parent_id, d.author_id, d.body, d.quote,
         d.resolved_at, d.resolved_by, d.created_at, d.edited_at,
         u.id AS u_id, u.email AS u_email, u.name AS u_name, u.avatar_url AS u_avatar
  FROM core.doc_comments d
  LEFT JOIN core.users u ON u.id = d.author_id`;

type MessageRow = {
  id: string;
  task_id: string | null;
  document_id: string | null;
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
      document_id: root.document_id,
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

/**
 * Треды владельца БЕЗ проверки доступа — для вызывающего, который её уже
 * сделал (карточка документа собирается после `requireKbAccess`). Отдельная
 * функция, а не флаг: пропуск проверки должен быть виден в месте вызова.
 */
export async function ownerThreads(owner: DocOwner): Promise<DocCommentThread[]> {
  const where = ownerWhere(owner);
  const rows = await prepare<MessageRow>(
    `${MESSAGE_SELECT}
     WHERE ${where.sql} AND d.deleted_at IS NULL
     ORDER BY d.created_at`,
  ).all(where.value);
  return groupThreads(rows);
}

export async function listDocComments(
  ctx: AuthContext,
  owner: DocOwner,
): Promise<DocCommentThread[]> {
  await requireDocOwner(ctx, owner, "view");
  return ownerThreads(owner);
}

async function loadThread(owner: DocOwner, threadId: string): Promise<DocCommentThread> {
  const where = ownerWhere(owner);
  const rows = await prepare<MessageRow>(
    `${MESSAGE_SELECT}
     WHERE ${where.sql} AND d.thread_id = ? AND d.deleted_at IS NULL
     ORDER BY d.created_at`,
  ).all(where.value, threadId);
  const [thread] = groupThreads(rows);
  if (!thread) throw new DomainError(404, "Обсуждение не найдено");
  return thread;
}

/** Кого оповестить: аудитория владельца плюс все, кто уже писал в этот тред. */
async function threadAudience(tx: TxContext, owner: DocOwner, threadId: string): Promise<string[]> {
  const base = await docOwnerAudience(tx, owner);
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
  owner: DocOwner,
  input: { body: string; quote: string },
): Promise<DocCommentThread> {
  await requireDocOwner(ctx, owner, "comment");
  const clean = cleanBody(input.body);
  // id треда совпадает с id корня и уходит в разметку документа, поэтому он
  // должен быть известен до вставки — иначе клиенту нечем пометить текст.
  const threadId = crypto.randomUUID();
  const cols = ownerColumns(owner);

  await transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO core.doc_comments (id, org_id, task_id, document_id, thread_id, author_id, body, quote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        threadId,
        ctx.orgId,
        cols.taskId,
        cols.documentId,
        threadId,
        ctx.user.id,
        clean,
        input.quote.slice(0, 2000),
      );

    const eventId = await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      ...ownerEntity(owner),
      verb: "doc_comment.added",
      payload: { thread_id: threadId, doc_comment_id: threadId },
    });
    // Упомянутые вычитаются из общей аудитории: у core.notifications нет
    // уникального ключа по (user_id, event_id), и подписчик, которого ещё и
    // упомянули, получил бы две строки на одно событие.
    const mentioned = await notifyMentions(tx, {
      orgId: ctx.orgId,
      eventId,
      owner,
      actorId: ctx.user.id,
      html: clean,
    });
    await notifyUsers(tx, {
      orgId: ctx.orgId,
      eventId,
      kind: "doc_comment",
      userIds: (await docOwnerAudience(tx, owner)).filter((id) => !mentioned.has(id)),
      excludeUserId: ctx.user.id,
    });
    // Как и обычный комментарий: обсуждающий начинает следить за задачей.
    // У документа подписки нет — его аудиторию задают авторство и правки.
    if (owner.kind === "task") {
      await tx
        .prepare(`INSERT INTO core.task_followers (task_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`)
        .run(owner.taskId, ctx.user.id);
    }
  });

  return loadThread(owner, threadId);
}

export async function replyToDocThread(
  ctx: AuthContext,
  owner: DocOwner,
  threadId: string,
  body: string,
): Promise<DocCommentThread> {
  await requireDocOwner(ctx, owner, "comment");
  const root = await prepare<{ id: string; task_id: string | null; document_id: string | null }>(
    `SELECT id, task_id, document_id FROM core.doc_comments
     WHERE id = ? AND thread_id = ? AND org_id = ? AND deleted_at IS NULL`,
  ).get(threadId, threadId, ctx.orgId);
  // Тред обязан принадлежать тому же владельцу: право проверено на этого, а
  // ответ иначе уехал бы в чужой документ.
  const sameOwner =
    !!root &&
    (owner.kind === "task" ? root.task_id === owner.taskId : root.document_id === owner.documentId);
  if (!sameOwner) throw new DomainError(404, "Обсуждение не найдено");
  const clean = cleanBody(body);
  const cols = ownerColumns(owner);

  const replyId = crypto.randomUUID();
  await transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO core.doc_comments (id, org_id, task_id, document_id, thread_id, parent_id, author_id, body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(replyId, ctx.orgId, cols.taskId, cols.documentId, threadId, threadId, ctx.user.id, clean);

    const eventId = await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      ...ownerEntity(owner),
      verb: "doc_comment.replied",
      payload: { thread_id: threadId, doc_comment_id: replyId },
    });
    const mentioned = await notifyMentions(tx, {
      orgId: ctx.orgId,
      eventId,
      owner,
      actorId: ctx.user.id,
      html: clean,
    });
    await notifyUsers(tx, {
      orgId: ctx.orgId,
      eventId,
      kind: "doc_comment",
      userIds: (await threadAudience(tx, owner, threadId)).filter((id) => !mentioned.has(id)),
      excludeUserId: ctx.user.id,
    });
    if (owner.kind === "task") {
      await tx
        .prepare(`INSERT INTO core.task_followers (task_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`)
        .run(owner.taskId, ctx.user.id);
    }
  });

  return loadThread(owner, threadId);
}

type MessageGuard = {
  id: string;
  org_id: string;
  task_id: string | null;
  document_id: string | null;
  thread_id: string;
  author_id: string | null;
  deleted_at: string | null;
};

/** Сообщение доступно только вместе с владельцем текста, к которому привязано. */
async function loadMessageForWrite(
  ctx: AuthContext,
  commentId: string,
): Promise<MessageGuard & { owner: DocOwner }> {
  const row = await prepare<MessageGuard>(
    `SELECT id, org_id, task_id, document_id, thread_id, author_id, deleted_at
     FROM core.doc_comments WHERE id = ?`,
  ).get(commentId);
  if (!row || row.org_id !== ctx.orgId || row.deleted_at) {
    throw new DomainError(404, "Комментарий не найден");
  }
  const owner = docOwnerOf(row);
  await requireDocOwner(ctx, owner, "view");
  return { ...row, owner };
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
  return loadThread(existing.owner, existing.thread_id);
}

/**
 * Закрыть или переоткрыть тред. Закрывает автор треда либо тот, кто может
 * править текст: обсуждение — часть документа, а не личная переписка автора.
 */
export async function setDocThreadResolved(
  ctx: AuthContext,
  threadId: string,
  resolved: boolean,
): Promise<DocCommentThread> {
  const root = await loadMessageForWrite(ctx, threadId);
  if (root.thread_id !== root.id) throw new DomainError(422, "Закрывается тред целиком");
  if (root.author_id !== ctx.user.id) {
    await requireDocOwner(ctx, root.owner, "edit");
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
      ...ownerEntity(root.owner),
      verb: resolved ? "doc_comment.resolved" : "doc_comment.reopened",
      payload: { thread_id: threadId },
    });
    if (resolved) {
      await notifyUsers(tx, {
        orgId: ctx.orgId,
        eventId,
        kind: "doc_comment_resolved",
        userIds: await threadAudience(tx, root.owner, threadId),
        excludeUserId: ctx.user.id,
      });
    }
  });

  return loadThread(root.owner, threadId);
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
