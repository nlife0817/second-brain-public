// Комментарии к задачам: добавление с fan-out, правка автором, мягкое удаление.

import { prepare, transaction } from "@/lib/sql";
import { sanitizeRichText } from "@/lib/sanitize";
import { emitEvent, notifyUsers, taskAudience } from "./events";
import { DomainError } from "./http";
import { canOrg } from "./policy";
import { requireTaskAccess } from "./tasks";
import type { AuthContext, CoreComment } from "./types";

const COMMENT_SELECT = `
  SELECT c.id, c.org_id, c.entity_type, c.entity_id, c.author_id, c.author_label,
         c.body, c.created_at, c.edited_at,
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
    author: r.u_id
      ? { id: r.u_id, email: r.u_email ?? "", name: r.u_name ?? "", avatar_url: r.u_avatar }
      : null,
  };
}

export async function listTaskComments(ctx: AuthContext, taskId: string): Promise<CoreComment[]> {
  await requireTaskAccess(ctx, taskId, "view");
  const rows = await prepare<CommentRow>(
    `${COMMENT_SELECT}
     WHERE c.entity_type = 'task' AND c.entity_id = ? AND c.deleted_at IS NULL
     ORDER BY c.created_at`,
  ).all(taskId);
  return rows.map(mapComment);
}

export async function addTaskComment(ctx: AuthContext, taskId: string, body: string): Promise<CoreComment> {
  await requireTaskAccess(ctx, taskId, "comment");
  const clean = sanitizeRichText(body);
  if (!clean.trim()) throw new DomainError(422, "Comment is empty");

  const commentId = await transaction(async (tx) => {
    const row = await tx
      .prepare<{ id: string }>(
        `INSERT INTO core.comments (org_id, entity_type, entity_id, author_id, body)
         VALUES (?, 'task', ?, ?, ?) RETURNING id`,
      )
      .get(ctx.orgId, taskId, ctx.user.id, clean);
    if (!row) throw new DomainError(500, "Failed to add comment");

    const eventId = await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "task",
      entityId: taskId,
      verb: "comment.added",
      payload: { comment_id: row.id },
    });
    await notifyUsers(tx, {
      orgId: ctx.orgId,
      eventId,
      kind: "comment",
      userIds: await taskAudience(tx, taskId),
      excludeUserId: ctx.user.id,
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
  deleted_at: string | null;
};

/** Комментарий доступен только вместе с сущностью, к которой он привязан. */
async function loadCommentForWrite(ctx: AuthContext, commentId: string): Promise<CommentGuard> {
  const existing = await prepare<CommentGuard>(
    `SELECT author_id, org_id, entity_type, entity_id, deleted_at FROM core.comments WHERE id = ?`,
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
  await prepare(`UPDATE core.comments SET deleted_at = now() WHERE id = ?`).run(commentId);
}
