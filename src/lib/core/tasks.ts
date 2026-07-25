// Доменный сервис задач: доступ (включая наследование от родителя и multi-homing),
// списки (проект, My Tasks), CRUD с событиями и fan-out уведомлений.

import { prepare, transaction, type TxContext } from "@/lib/sql";
import { sanitizeRichText } from "@/lib/sanitize";
import { emitEvent, notifyUsers, taskAudience } from "./events";
import { DomainError } from "./http";
import {
  assertOrg,
  canEditLooseTask,
  canViewLooseTask,
  effectiveProjectRole,
  PolicyError,
} from "./policy";
import { getProject, requireProject } from "./projects";
import type {
  AuthContext,
  CoreTag,
  CoreTask,
  Project,
  ProjectRole,
  TaskDetail,
  TaskPlacement,
  TaskPriority,
  TaskStatus,
  TaskWithMeta,
  UserBrief,
} from "./types";
import { PROJECT_ROLE_RANK } from "./types";

// --- Доступ -----------------------------------------------------------------------

export interface TaskAccess {
  task: CoreTask;
  /** Проекты, в которых размещена сама задача (не предки). */
  placements: Array<TaskPlacement & { project: Project }>;
  canView: boolean;
  canEdit: boolean;
  canComment: boolean;
  /** Есть роль editor+ во всех размещениях (нужно для глобального удаления). */
  canEditAllPlacements: boolean;
}

async function getTaskRow(taskId: string): Promise<CoreTask | undefined> {
  return prepare<CoreTask>(`SELECT * FROM core.tasks WHERE id = ?`).get(taskId);
}

/**
 * Правила доступа (зеркало SQL core.can_view_task):
 *  - задача в проекте: доступ дают роль в проекте (своём или предка), назначение
 *    и авторство. Подписка (follower) НЕ является основанием — иначе исключённый
 *    из проекта участник сохранял бы доступ навсегда через самоподписку;
 *  - «свободная» задача (нет размещений во всей цепочке): создатель, исполнитель
 *    и подписчик — как в личном инбоксе;
 *  - редактирование: editor+ в любом проекте цепочки (родитель распространяется
 *    на подзадачи) или назначение на саму задачу.
 */
export async function loadTaskAccess(ctx: AuthContext, taskId: string): Promise<TaskAccess | undefined> {
  const task = await getTaskRow(taskId);
  if (!task || task.org_id !== ctx.orgId) return undefined;

  const chain: CoreTask[] = [task];
  let cursor = task;
  for (let depth = 0; depth < 8 && cursor.parent_task_id; depth++) {
    const parent = await getTaskRow(cursor.parent_task_id);
    if (!parent) break;
    chain.push(parent);
    cursor = parent;
  }
  const chainIds = chain.map((t) => t.id);
  const ph = chainIds.map(() => "?").join(",");

  const myLinks = await prepare<{ task_id: string; src: string }>(
    `SELECT task_id, 'assignee' AS src FROM core.task_assignees WHERE user_id = ? AND task_id IN (${ph})
     UNION ALL
     SELECT task_id, 'follower' AS src FROM core.task_followers WHERE user_id = ? AND task_id IN (${ph})`,
  ).all(ctx.user.id, chainIds, ctx.user.id, chainIds);

  const chainPlacements = await prepare<{ task_id: string; project_id: string; section_id: string | null; position: number } & { p_org_id: string; p_visibility: "org" | "private" }>(
    `SELECT tp.task_id, tp.project_id, tp.section_id, tp.position,
            p.org_id AS p_org_id, p.visibility AS p_visibility
     FROM core.task_projects tp
     JOIN core.projects p ON p.id = tp.project_id
     WHERE tp.task_id IN (${ph})`,
  ).all(chainIds);

  const isCreator = chain.some((t) => t.created_by === ctx.user.id);
  const isDirectAssignee = myLinks.some((l) => l.src === "assignee" && l.task_id === task.id);
  const isChainAssignee = myLinks.some((l) => l.src === "assignee");
  const isChainFollower = myLinks.some((l) => l.src === "follower");

  const roleOf = (projectId: string, orgId: string, visibility: "org" | "private"): ProjectRole | null =>
    effectiveProjectRole(ctx, { id: projectId, org_id: orgId, visibility });

  const chainProjectRoles = chainPlacements.map((pl) => roleOf(pl.project_id, pl.p_org_id, pl.p_visibility));
  const anyProjectView = chainProjectRoles.some((r) => r !== null);

  const directPlacementRows = chainPlacements.filter((pl) => pl.task_id === task.id);
  const directRoles = directPlacementRows.map((pl) => roleOf(pl.project_id, pl.p_org_id, pl.p_visibility));
  const allDirectEditor =
    directRoles.length > 0 && directRoles.every((r) => r !== null && PROJECT_ROLE_RANK[r] >= PROJECT_ROLE_RANK.editor);
  const anyChainEditor = chainProjectRoles.some(
    (r) => r !== null && PROJECT_ROLE_RANK[r] >= PROJECT_ROLE_RANK.editor,
  );
  const anyChainCommenter = chainProjectRoles.some(
    (r) => r !== null && PROJECT_ROLE_RANK[r] >= PROJECT_ROLE_RANK.commenter,
  );

  const isFree = chainPlacements.length === 0;
  const loose = { isCreator, isAssignee: isChainAssignee, isFollower: isChainFollower };
  const canView = isFree
    ? canViewLooseTask(loose)
    : anyProjectView || isCreator || isChainAssignee;
  const canEdit = isFree
    ? canEditLooseTask(loose)
    : anyChainEditor || isDirectAssignee || isChainAssignee;
  const canComment = canView && (isFree || anyChainCommenter || isCreator || isChainAssignee);

  if (!canView) return undefined;

  const projectsById = new Map<string, Project>();
  for (const pl of directPlacementRows) {
    if (!projectsById.has(pl.project_id)) {
      const p = await getProject(pl.project_id);
      if (p) projectsById.set(pl.project_id, p);
    }
  }

  return {
    task,
    placements: directPlacementRows.map((pl) => ({
      project_id: pl.project_id,
      section_id: pl.section_id,
      position: pl.position,
      project: projectsById.get(pl.project_id)!,
    })),
    canView,
    canEdit,
    canComment,
    canEditAllPlacements:
      directPlacementRows.length === 0 ? canEdit : allDirectEditor || anyChainEditor,
  };
}

export async function requireTaskAccess(
  ctx: AuthContext,
  taskId: string,
  level: "view" | "edit" | "comment",
): Promise<TaskAccess> {
  const access = await loadTaskAccess(ctx, taskId);
  if (!access) throw new DomainError(404, "Task not found");
  if (level === "edit" && !access.canEdit) throw new PolicyError("task.edit");
  if (level === "comment" && !access.canComment) throw new PolicyError("task.comment");
  return access;
}

// --- Обогащение списков -------------------------------------------------------------

async function enrichTasks(rows: CoreTask[]): Promise<TaskWithMeta[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((t) => t.id);
  const ph = ids.map(() => "?").join(",");

  const [assignees, tags, placements, subtasks, comments] = await Promise.all([
    prepare<{ task_id: string; is_primary: boolean } & UserBrief>(
      `SELECT ta.task_id, ta.is_primary, u.id, u.email, u.name, u.avatar_url
       FROM core.task_assignees ta JOIN core.users u ON u.id = ta.user_id
       WHERE ta.task_id IN (${ph})
       ORDER BY ta.is_primary DESC, ta.created_at`,
    ).all(ids),
    prepare<{ task_id: string } & CoreTag>(
      `SELECT tt.task_id, g.id, g.org_id, g.name, g.color, g.position
       FROM core.task_tags tt JOIN core.tags g ON g.id = tt.tag_id
       WHERE tt.task_id IN (${ph})
       ORDER BY g.position, g.name`,
    ).all(ids),
    prepare<{ task_id: string; project_id: string; section_id: string | null; position: number }>(
      `SELECT task_id, project_id, section_id, position FROM core.task_projects WHERE task_id IN (${ph})`,
    ).all(ids),
    prepare<{ parent_task_id: string; total: number; done: number }>(
      `SELECT parent_task_id, count(*)::int AS total,
              count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS done
       FROM core.tasks WHERE parent_task_id IN (${ph}) GROUP BY parent_task_id`,
    ).all(ids),
    prepare<{ entity_id: string; n: number }>(
      `SELECT entity_id, count(*)::int AS n FROM core.comments
       WHERE entity_type = 'task' AND deleted_at IS NULL AND entity_id IN (${ph})
       GROUP BY entity_id`,
    ).all(ids),
  ]);

  const byTask = <T extends { task_id: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const row of list) {
      const arr = m.get(row.task_id) ?? [];
      arr.push(row);
      m.set(row.task_id, arr);
    }
    return m;
  };
  const assigneeMap = byTask(assignees);
  const tagMap = byTask(tags);
  const placementMap = byTask(placements);
  const subtaskMap = new Map(subtasks.map((s) => [s.parent_task_id, s]));
  const commentMap = new Map(comments.map((c) => [c.entity_id, c.n]));

  return rows.map((t) => ({
    ...t,
    assignees: (assigneeMap.get(t.id) ?? []).map((a) => ({
      id: a.id, email: a.email, name: a.name, avatar_url: a.avatar_url,
    })),
    tags: (tagMap.get(t.id) ?? []).map((g) => ({
      id: g.id, org_id: g.org_id, name: g.name, color: g.color, position: g.position,
    })),
    placements: (placementMap.get(t.id) ?? []).map((p) => ({
      project_id: p.project_id, section_id: p.section_id, position: p.position,
    })),
    subtask_count: subtaskMap.get(t.id)?.total ?? 0,
    subtask_done_count: subtaskMap.get(t.id)?.done ?? 0,
    comment_count: commentMap.get(t.id) ?? 0,
  }));
}

// --- Списки ---------------------------------------------------------------------------

export async function listProjectTasks(
  ctx: AuthContext,
  projectId: string,
  opts: { includeDone?: boolean } = {},
): Promise<TaskWithMeta[]> {
  await requireProject(ctx, projectId, "project.view");
  const rows = await prepare<CoreTask>(
    `SELECT t.* FROM core.task_projects tp
     JOIN core.tasks t ON t.id = tp.task_id
     WHERE tp.project_id = ?
       AND (?::boolean OR t.completed_at IS NULL OR t.completed_at > now() - interval '14 days')
     ORDER BY tp.position, t.created_at`,
  ).all(projectId, opts.includeDone ?? false);
  return enrichTasks(rows);
}

export async function listMyTasks(
  ctx: AuthContext,
  opts: { includeDone?: boolean } = {},
): Promise<TaskWithMeta[]> {
  const rows = await prepare<CoreTask>(
    `SELECT DISTINCT t.* FROM core.tasks t
     LEFT JOIN core.task_assignees a ON a.task_id = t.id AND a.user_id = ?
     WHERE t.org_id = ?
       AND (
         a.user_id IS NOT NULL
         OR (
           t.created_by = ?
           AND NOT EXISTS (SELECT 1 FROM core.task_projects tp WHERE tp.task_id = t.id)
           AND NOT EXISTS (SELECT 1 FROM core.task_assignees a2 WHERE a2.task_id = t.id)
           AND t.parent_task_id IS NULL
         )
       )
       AND (?::boolean OR t.completed_at IS NULL OR t.completed_at > now() - interval '7 days')
     ORDER BY t.due_date NULLS LAST, t.created_at DESC`,
  ).all(ctx.user.id, ctx.orgId, ctx.user.id, opts.includeDone ?? false);
  return enrichTasks(rows);
}

export async function listSubtasks(ctx: AuthContext, parentTaskId: string): Promise<TaskWithMeta[]> {
  await requireTaskAccess(ctx, parentTaskId, "view");
  const rows = await prepare<CoreTask>(
    `SELECT * FROM core.tasks WHERE parent_task_id = ? ORDER BY created_at`,
  ).all(parentTaskId);
  return enrichTasks(rows);
}

export async function getTaskDetail(ctx: AuthContext, taskId: string): Promise<TaskDetail> {
  const access = await requireTaskAccess(ctx, taskId, "view");
  const [meta] = await enrichTasks([access.task]);
  const followers = await prepare<UserBrief>(
    `SELECT u.id, u.email, u.name, u.avatar_url
     FROM core.task_followers f JOIN core.users u ON u.id = f.user_id
     WHERE f.task_id = ? ORDER BY f.created_at`,
  ).all(taskId);
  const values = await prepare<{ field_id: string; value: unknown }>(
    `SELECT field_id, value FROM core.task_field_values WHERE task_id = ?`,
  ).all(taskId);
  const creator = access.task.created_by
    ? await prepare<UserBrief>(`SELECT id, email, name, avatar_url FROM core.users WHERE id = ?`).get(access.task.created_by)
    : undefined;
  return {
    ...meta,
    followers,
    field_values: Object.fromEntries(values.map((v) => [v.field_id, v.value])),
    creator: creator ?? null,
  };
}

// --- Вспомогательное для мутаций -------------------------------------------------------

async function getOrgStatus(ctx: AuthContext, statusId: string): Promise<TaskStatus> {
  const status = await prepare<TaskStatus>(
    `SELECT id, org_id, name, color, kind, position FROM core.task_statuses WHERE id = ? AND org_id = ?`,
  ).get(statusId, ctx.orgId);
  if (!status) throw new DomainError(422, "Unknown status");
  return status;
}

async function assertOrgUsers(ctx: AuthContext, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const ph = userIds.map(() => "?").join(",");
  const rows = await prepare<{ user_id: string }>(
    `SELECT user_id FROM core.org_members WHERE org_id = ? AND user_id IN (${ph})`,
  ).all(ctx.orgId, userIds);
  if (rows.length !== new Set(userIds).size) {
    throw new DomainError(422, "Assignee is not a member of this organization");
  }
}

async function assertOrgTags(ctx: AuthContext, tagIds: string[]): Promise<void> {
  if (tagIds.length === 0) return;
  const ph = tagIds.map(() => "?").join(",");
  const rows = await prepare<{ id: string }>(
    `SELECT id FROM core.tags WHERE org_id = ? AND id IN (${ph})`,
  ).all(ctx.orgId, tagIds);
  if (rows.length !== new Set(tagIds).size) throw new DomainError(422, "Unknown tag");
}

async function nextPlacementPosition(tx: TxContext, projectId: string, sectionId: string | null): Promise<number> {
  const row = await tx
    .prepare<{ p: number | null }>(
      `SELECT max(position) AS p FROM core.task_projects WHERE project_id = ? AND section_id IS NOT DISTINCT FROM ?`,
    )
    .get(projectId, sectionId);
  return (row?.p ?? 0) + 1;
}

async function assertSectionInProject(sectionId: string, projectId: string): Promise<void> {
  const row = await prepare(`SELECT 1 FROM core.sections WHERE id = ? AND project_id = ?`).get(sectionId, projectId);
  if (!row) throw new DomainError(422, "Section does not belong to the project");
}

/**
 * Ровно один ответственный на задачу. Приоритет: явно переданный primaryUserId,
 * иначе текущий is_primary, иначе самый ранний назначенный. Полагаться на
 * created_at внутри одной транзакции нельзя — у всех строк одинаковый now().
 */
async function syncPrimaryAssignee(
  tx: TxContext,
  taskId: string,
  primaryUserId?: string | null,
): Promise<void> {
  const rows = await tx
    .prepare<{ user_id: string; is_primary: boolean }>(
      `SELECT user_id, is_primary FROM core.task_assignees WHERE task_id = ? ORDER BY created_at`,
    )
    .all(taskId);
  if (rows.length === 0) return;
  const primary =
    (primaryUserId && rows.some((r) => r.user_id === primaryUserId) ? primaryUserId : null) ??
    rows.find((r) => r.is_primary)?.user_id ??
    rows[0].user_id;
  await tx
    .prepare(`UPDATE core.task_assignees SET is_primary = (user_id = ?) WHERE task_id = ?`)
    .run(primary, taskId);
}

/** Postgres отдаёт time как "HH:MM:SS", клиент шлёт "HH:MM" — сравниваем в одном формате. */
function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 5);
}

// --- Создание ---------------------------------------------------------------------------

export interface CreateTaskInput {
  title: string;
  description?: string;
  status_id?: string | null;
  priority?: TaskPriority;
  due_date?: string | null;
  due_time?: string | null;
  estimated_minutes?: number | null;
  parent_task_id?: string | null;
  placements?: Array<{ project_id: string; section_id?: string | null }>;
  assignee_ids?: string[];
  tag_ids?: string[];
  source?: string;
}

export async function createTask(ctx: AuthContext, input: CreateTaskInput): Promise<TaskDetail> {
  const placements = input.placements ?? [];
  // Задача без проекта попадает в личный инбокс и может быть назначена коллеге —
  // гостю такой канал закрыт (иначе внешний подрядчик рассылает задачи всей org).
  if (placements.length === 0 && !input.parent_task_id) assertOrg(ctx, "task.create.personal");
  for (const pl of placements) {
    await requireProject(ctx, pl.project_id, "task.create");
    if (pl.section_id) await assertSectionInProject(pl.section_id, pl.project_id);
  }
  if (input.parent_task_id) {
    await requireTaskAccess(ctx, input.parent_task_id, "edit");
  }
  const assigneeIds = [...new Set(input.assignee_ids ?? [])];
  await assertOrgUsers(ctx, assigneeIds);
  const tagIds = [...new Set(input.tag_ids ?? [])];
  await assertOrgTags(ctx, tagIds);
  const status = input.status_id ? await getOrgStatus(ctx, input.status_id) : null;

  const taskId = await transaction(async (tx) => {
    const row = await tx
      .prepare<{ id: string }>(
        `INSERT INTO core.tasks
           (org_id, title, description, status_id, priority, due_date, due_time,
            estimated_minutes, parent_task_id, source, created_by, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .get(
        ctx.orgId,
        input.title.trim(),
        sanitizeRichText(input.description ?? ""),
        status?.id ?? null,
        input.priority ?? "none",
        input.due_date ?? null,
        input.due_time ?? null,
        input.estimated_minutes ?? null,
        input.parent_task_id ?? null,
        input.source ?? "app",
        ctx.user.id,
        status?.kind === "done" ? new Date().toISOString() : null,
      );
    if (!row) throw new DomainError(500, "Failed to create task");
    const id = row.id;

    for (const pl of placements) {
      await tx
        .prepare(
          `INSERT INTO core.task_projects (task_id, project_id, section_id, position) VALUES (?, ?, ?, ?)
           ON CONFLICT (task_id, project_id) DO NOTHING`,
        )
        .run(id, pl.project_id, pl.section_id ?? null, await nextPlacementPosition(tx, pl.project_id, pl.section_id ?? null));
    }
    for (let i = 0; i < assigneeIds.length; i++) {
      await tx
        .prepare(`INSERT INTO core.task_assignees (task_id, user_id, is_primary) VALUES (?, ?, ?)`)
        .run(id, assigneeIds[i], i === 0);
    }
    await tx
      .prepare(`INSERT INTO core.task_followers (task_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .run(id, ctx.user.id);
    for (const tagId of tagIds) {
      await tx.prepare(`INSERT INTO core.task_tags (task_id, tag_id) VALUES (?, ?)`).run(id, tagId);
    }

    const eventId = await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "task",
      entityId: id,
      verb: "task.created",
      payload: { title: input.title.trim() },
    });
    if (assigneeIds.length > 0) {
      await notifyUsers(tx, {
        orgId: ctx.orgId,
        eventId,
        kind: "assigned",
        userIds: assigneeIds,
        excludeUserId: ctx.user.id,
      });
    }
    return id;
  });

  return getTaskDetail(ctx, taskId);
}

// --- Обновление ----------------------------------------------------------------------------

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status_id?: string | null;
  priority?: TaskPriority;
  due_date?: string | null;
  due_time?: string | null;
  estimated_minutes?: number | null;
  assignee_ids?: string[];
  tag_ids?: string[];
}

export async function updateTask(ctx: AuthContext, taskId: string, patch: UpdateTaskInput): Promise<TaskDetail> {
  const access = await requireTaskAccess(ctx, taskId, "edit");
  const task = access.task;

  const nextStatus =
    patch.status_id !== undefined && patch.status_id !== null ? await getOrgStatus(ctx, patch.status_id) : null;
  const prevStatus = task.status_id
    ? await prepare<TaskStatus>(`SELECT id, org_id, name, color, kind, position FROM core.task_statuses WHERE id = ?`).get(task.status_id)
    : undefined;

  if (patch.assignee_ids) await assertOrgUsers(ctx, patch.assignee_ids);
  if (patch.tag_ids) await assertOrgTags(ctx, patch.tag_ids);

  await transaction(async (tx) => {
    const changedFields: string[] = [];
    const scalar: Record<string, unknown> = {};
    if (patch.title !== undefined && patch.title.trim() !== task.title) {
      scalar.title = patch.title.trim();
      changedFields.push("title");
    }
    if (patch.description !== undefined) {
      const clean = sanitizeRichText(patch.description);
      if (clean !== task.description) {
        scalar.description = clean;
        changedFields.push("description");
      }
    }
    if (patch.priority !== undefined && patch.priority !== task.priority) {
      scalar.priority = patch.priority;
      changedFields.push("priority");
    }
    if (patch.due_date !== undefined && patch.due_date !== task.due_date) {
      scalar.due_date = patch.due_date;
      changedFields.push("due_date");
    }
    if (patch.due_time !== undefined && normalizeTime(patch.due_time) !== normalizeTime(task.due_time)) {
      scalar.due_time = patch.due_time;
      changedFields.push("due_time");
    }
    if (patch.estimated_minutes !== undefined && patch.estimated_minutes !== task.estimated_minutes) {
      scalar.estimated_minutes = patch.estimated_minutes;
      changedFields.push("estimated_minutes");
    }

    const statusChanged = patch.status_id !== undefined && patch.status_id !== task.status_id;
    if (statusChanged) {
      scalar.status_id = patch.status_id;
      const becameDone = nextStatus?.kind === "done";
      const wasDone = prevStatus?.kind === "done";
      if (becameDone && !wasDone) scalar.completed_at = new Date().toISOString();
      if (!becameDone && wasDone) scalar.completed_at = null;
    }

    if (Object.keys(scalar).length > 0) {
      const sets = Object.keys(scalar).map((k) => `${k} = ?`).join(", ");
      await tx.prepare(`UPDATE core.tasks SET ${sets} WHERE id = ?`).run(...Object.values(scalar), taskId);
    }

    const audience = await taskAudience(tx, taskId);

    if (changedFields.length > 0) {
      const eventId = await emitEvent(tx, {
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        entityType: "task",
        entityId: taskId,
        verb: "task.updated",
        payload: { fields: changedFields },
      });
      if (changedFields.includes("due_date") || changedFields.includes("due_time")) {
        await notifyUsers(tx, {
          orgId: ctx.orgId,
          eventId,
          kind: "due_changed",
          userIds: audience,
          excludeUserId: ctx.user.id,
        });
      }
    }

    if (statusChanged) {
      const eventId = await emitEvent(tx, {
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        entityType: "task",
        entityId: taskId,
        verb: nextStatus?.kind === "done" ? "task.completed" : "task.status_changed",
        payload: {
          from: prevStatus?.name ?? null,
          to: nextStatus?.name ?? null,
        },
      });
      await notifyUsers(tx, {
        orgId: ctx.orgId,
        eventId,
        kind: nextStatus?.kind === "done" ? "completed" : "status_changed",
        userIds: audience,
        excludeUserId: ctx.user.id,
      });
    }

    if (patch.assignee_ids) {
      const current = await tx
        .prepare<{ user_id: string }>(`SELECT user_id FROM core.task_assignees WHERE task_id = ?`)
        .all(taskId);
      const currentSet = new Set(current.map((r) => r.user_id));
      const nextSet = new Set(patch.assignee_ids);
      const added = [...nextSet].filter((id) => !currentSet.has(id));
      const removed = [...currentSet].filter((id) => !nextSet.has(id));

      for (const userId of removed) {
        await tx.prepare(`DELETE FROM core.task_assignees WHERE task_id = ? AND user_id = ?`).run(taskId, userId);
      }
      for (const userId of added) {
        await tx
          .prepare(`INSERT INTO core.task_assignees (task_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`)
          .run(taskId, userId);
      }
      if (added.length > 0 || removed.length > 0) {
        await syncPrimaryAssignee(tx, taskId, patch.assignee_ids[0] ?? null);
        const eventId = await emitEvent(tx, {
          orgId: ctx.orgId,
          actorId: ctx.user.id,
          entityType: "task",
          entityId: taskId,
          verb: "task.assigned",
          payload: { added, removed },
        });
        if (added.length > 0) {
          await notifyUsers(tx, {
            orgId: ctx.orgId,
            eventId,
            kind: "assigned",
            userIds: added,
            excludeUserId: ctx.user.id,
          });
        }
      }
    }

    if (patch.tag_ids) {
      const currentTags = await tx
        .prepare<{ tag_id: string }>(`SELECT tag_id FROM core.task_tags WHERE task_id = ?`)
        .all(taskId);
      const currentTagSet = new Set(currentTags.map((r) => r.tag_id));
      const nextTagSet = new Set(patch.tag_ids);
      const tagsChanged =
        currentTagSet.size !== nextTagSet.size || [...nextTagSet].some((id) => !currentTagSet.has(id));

      await tx.prepare(`DELETE FROM core.task_tags WHERE task_id = ?`).run(taskId);
      for (const tagId of nextTagSet) {
        await tx.prepare(`INSERT INTO core.task_tags (task_id, tag_id) VALUES (?, ?)`).run(taskId, tagId);
      }
      if (tagsChanged) {
        await emitEvent(tx, {
          orgId: ctx.orgId,
          actorId: ctx.user.id,
          entityType: "task",
          entityId: taskId,
          verb: "task.tags_changed",
          payload: {
            added: [...nextTagSet].filter((id) => !currentTagSet.has(id)),
            removed: [...currentTagSet].filter((id) => !nextTagSet.has(id)),
          },
        });
      }
    }
  });

  return getTaskDetail(ctx, taskId);
}

// --- Multi-homing и перемещение ---------------------------------------------------------------

export async function setTaskPlacements(
  ctx: AuthContext,
  taskId: string,
  placements: Array<{ project_id: string; section_id?: string | null }>,
): Promise<TaskDetail> {
  const access = await requireTaskAccess(ctx, taskId, "edit");
  const currentByProject = new Map(access.placements.map((p) => [p.project_id, p]));
  const nextByProject = new Map(placements.map((p) => [p.project_id, p]));

  const addsPlacement = [...nextByProject.keys()].some((id) => !currentByProject.has(id));
  if (addsPlacement) {
    // Расширять видимость задачи вправе только тот, кто сам редактор во всех её
    // текущих проектах: иначе исполнитель выносит задачу из приватного проекта
    // в свой и открывает её посторонним.
    for (const projectId of currentByProject.keys()) {
      await requireProject(ctx, projectId, "task.edit");
    }
  }

  for (const [projectId, pl] of nextByProject) {
    if (!currentByProject.has(projectId)) {
      await requireProject(ctx, projectId, "task.create");
    }
    if (pl.section_id) await assertSectionInProject(pl.section_id, projectId);
  }
  for (const projectId of currentByProject.keys()) {
    if (!nextByProject.has(projectId)) {
      await requireProject(ctx, projectId, "task.edit");
    }
  }

  await transaction(async (tx) => {
    for (const [projectId] of currentByProject) {
      if (!nextByProject.has(projectId)) {
        await tx.prepare(`DELETE FROM core.task_projects WHERE task_id = ? AND project_id = ?`).run(taskId, projectId);
        await emitEvent(tx, {
          orgId: ctx.orgId,
          actorId: ctx.user.id,
          entityType: "task",
          entityId: taskId,
          verb: "task.unhomed",
          payload: { project_id: projectId },
        });
      }
    }
    for (const [projectId, pl] of nextByProject) {
      const existing = currentByProject.get(projectId);
      if (!existing) {
        await tx
          .prepare(`INSERT INTO core.task_projects (task_id, project_id, section_id, position) VALUES (?, ?, ?, ?)`)
          .run(taskId, projectId, pl.section_id ?? null, await nextPlacementPosition(tx, projectId, pl.section_id ?? null));
        await emitEvent(tx, {
          orgId: ctx.orgId,
          actorId: ctx.user.id,
          entityType: "task",
          entityId: taskId,
          verb: "task.homed",
          payload: { project_id: projectId },
        });
      } else if ((pl.section_id ?? null) !== existing.section_id) {
        await tx
          .prepare(`UPDATE core.task_projects SET section_id = ?, position = ? WHERE task_id = ? AND project_id = ?`)
          .run(pl.section_id ?? null, await nextPlacementPosition(tx, projectId, pl.section_id ?? null), taskId, projectId);
      }
    }
  });

  return getTaskDetail(ctx, taskId);
}

/** Перемещение внутри проекта (канбан drag&drop): секция и/или позиция. */
export async function moveTaskInProject(
  ctx: AuthContext,
  taskId: string,
  projectId: string,
  target: { section_id?: string | null; position?: number },
): Promise<void> {
  await requireProject(ctx, projectId, "task.edit");
  const access = await requireTaskAccess(ctx, taskId, "view");
  const placement = access.placements.find((p) => p.project_id === projectId);
  if (!placement) throw new DomainError(404, "Task is not in this project");
  if (target.section_id) await assertSectionInProject(target.section_id, projectId);

  await prepare(
    `UPDATE core.task_projects SET section_id = ?, position = ? WHERE task_id = ? AND project_id = ?`,
  ).run(
    target.section_id === undefined ? placement.section_id : target.section_id,
    target.position ?? placement.position,
    taskId,
    projectId,
  );
}

// --- Подписка и удаление -----------------------------------------------------------------------

export async function setFollowing(ctx: AuthContext, taskId: string, follow: boolean): Promise<void> {
  await requireTaskAccess(ctx, taskId, "view");
  if (follow) {
    await prepare(`INSERT INTO core.task_followers (task_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`).run(taskId, ctx.user.id);
  } else {
    await prepare(`DELETE FROM core.task_followers WHERE task_id = ? AND user_id = ?`).run(taskId, ctx.user.id);
  }
}

export async function deleteTask(ctx: AuthContext, taskId: string): Promise<void> {
  const access = await requireTaskAccess(ctx, taskId, "edit");
  // Глобальное удаление: нужен editor во ВСЕХ размещениях (у свободной задачи —
  // права создателя/исполнителя уже проверены через canEdit).
  if (!access.canEditAllPlacements) {
    throw new PolicyError("task.delete");
  }
  await transaction(async (tx) => {
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "task",
      entityId: taskId,
      verb: "task.deleted",
      payload: { title: access.task.title },
    });
    await tx.prepare(`DELETE FROM core.tasks WHERE id = ?`).run(taskId);
  });
}
