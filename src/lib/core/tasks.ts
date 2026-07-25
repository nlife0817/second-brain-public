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
import { requireProject } from "./projects";
import type {
  AllTasksResult,
  AuthContext,
  CoreTag,
  CoreTask,
  Project,
  ProjectRole,
  TaskDetail,
  TaskListItem,
  TaskMeta,
  TaskPlacement,
  TaskPriority,
  TaskStatus,
  UserBrief,
} from "./types";
import { PROJECT_ROLE_RANK } from "./types";

// --- Доступ -----------------------------------------------------------------------

export interface TaskAccess {
  task: CoreTask;
  /** Проекты, в которых размещена сама задача (не предки). */
  placements: Array<TaskPlacement & { project: Project }>;
  /** Проекты всей цепочки, включая родительские: определяют, кто уже видит задачу. */
  chainProjectIds: string[];
  canView: boolean;
  canEdit: boolean;
  canComment: boolean;
  /** Есть роль editor+ во всех размещениях (нужно для глобального удаления). */
  canEditAllPlacements: boolean;
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
  // Задача и её предки — одним запросом. Последовательный обход родителей давал
  // до 8 round-trip к базе на каждую проверку доступа, а она предшествует любой
  // мутации задачи.
  const chainRows = await prepare<CoreTask>(
    `WITH RECURSIVE chain AS (
       SELECT t.*, 0 AS depth FROM core.tasks t WHERE t.id = ?
       UNION ALL
       SELECT p.*, c.depth + 1 FROM core.tasks p
         JOIN chain c ON p.id = c.parent_task_id
       WHERE c.depth < 8
     )
     SELECT id, org_id, title, description, status_id, priority, due_date, due_time,
            estimated_minutes, completed_at, parent_task_id, source, created_by,
            created_at, updated_at
     FROM chain ORDER BY depth`,
  ).all(taskId);

  // depth только упорядочивает выборку (корень первым) и наружу не отдаётся.
  const task = chainRows[0];
  if (!task || task.org_id !== ctx.orgId) return undefined;
  const chain = chainRows;
  const chainIds = chain.map((t) => t.id);
  const ph = chainIds.map(() => "?").join(",");

  const [myLinks, chainPlacements] = await Promise.all([
    prepare<{ task_id: string; src: string }>(
      `SELECT task_id, 'assignee' AS src FROM core.task_assignees WHERE user_id = ? AND task_id IN (${ph})
       UNION ALL
       SELECT task_id, 'follower' AS src FROM core.task_followers WHERE user_id = ? AND task_id IN (${ph})`,
    ).all(ctx.user.id, chainIds, ctx.user.id, chainIds),
    prepare<{ task_id: string; project_id: string; section_id: string | null; position: number } & { p_org_id: string; p_visibility: "org" | "private" }>(
      `SELECT tp.task_id, tp.project_id, tp.section_id, tp.position,
              p.org_id AS p_org_id, p.visibility AS p_visibility
       FROM core.task_projects tp
       JOIN core.projects p ON p.id = tp.project_id
       WHERE tp.task_id IN (${ph})`,
    ).all(chainIds),
  ]);

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

  // Проекты размещений — одним запросом: цикл с getProject давал N+1.
  const directProjectIds = [...new Set(directPlacementRows.map((pl) => pl.project_id))];
  const projectsById = new Map<string, Project>();
  if (directProjectIds.length > 0) {
    const projectPh = directProjectIds.map(() => "?").join(",");
    const projectRows = await prepare<Project>(
      `SELECT * FROM core.projects WHERE id IN (${projectPh})`,
    ).all(directProjectIds);
    for (const p of projectRows) projectsById.set(p.id, p);
  }

  return {
    task,
    chainProjectIds: [...new Set(chainPlacements.map((pl) => pl.project_id))],
    placements: directPlacementRows.map((pl) => ({
      project_id: pl.project_id,
      section_id: pl.section_id,
      position: pl.position,
      project: projectsById.get(pl.project_id)!,
    })),
    canView,
    canEdit,
    canComment,
    // Удаление задачи затрагивает все её проекты, поэтому нужен editor в каждом:
    // права в родительском проекте (anyChainEditor) здесь не годятся.
    canEditAllPlacements: directPlacementRows.length === 0 ? canEdit : allDirectEditor,
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

/**
 * Колонки задачи без `description`: списки его не показывают, а на проекте в
 * 700 задач HTML описаний — четверть веса ответа.
 */
const TASK_LIST_COLUMNS = `t.id, t.org_id, t.title, t.status_id, t.priority, t.due_date, t.due_time,
   t.estimated_minutes, t.completed_at, t.parent_task_id, t.source, t.created_by, t.created_at, t.updated_at`;

async function enrichTasks<T extends { id: string }>(rows: T[]): Promise<Array<T & TaskMeta>> {
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
): Promise<TaskListItem[]> {
  await requireProject(ctx, projectId, "project.view");
  const rows = await prepare<Omit<CoreTask, "description">>(
    `SELECT ${TASK_LIST_COLUMNS} FROM core.task_projects tp
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
): Promise<TaskListItem[]> {
  const rows = await prepare<Omit<CoreTask, "description">>(
    `SELECT DISTINCT ${TASK_LIST_COLUMNS} FROM core.tasks t
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

/**
 * Потолок сводного списка. Фильтрация, сортировка и группировка в «Все задачи»
 * идут на клиенте (как в списке v1) — иначе счётчики групп врут при пагинации.
 * Чтобы это оставалось честным, ответ ограничен и помечается `truncated`.
 */
const ALL_TASKS_CAP = 3000;

/** Проекты организации, которые пользователь вправе видеть (решает policy). */
export async function visibleProjectIds(
  ctx: AuthContext,
  opts: { includeArchived?: boolean } = {},
): Promise<string[]> {
  const rows = await prepare<{ id: string; org_id: string; visibility: "org" | "private" }>(
    `SELECT id, org_id, visibility FROM core.projects
     WHERE org_id = ? AND (?::boolean OR archived_at IS NULL)`,
  ).all(ctx.orgId, opts.includeArchived ?? false);
  return rows.filter((p) => effectiveProjectRole(ctx, p) !== null).map((p) => p.id);
}

/**
 * Пакетная версия правил из `loadTaskAccess` — одним SQL вместо запроса на
 * задачу. Возвращает готовые куски запроса, чтобы правило видимости жило в
 * одном месте: разъехавшиеся копии этой логики и есть класс ошибок, ради
 * которого policy сделан единственным источником истины.
 *
 * Параметры отдаются в порядке появления `?` в тексте: сперва `cteParams`
 * (CTE идёт первым), затем — там, где вставлен `clause`, его `clauseParams`.
 */
function taskVisibility(
  ctx: AuthContext,
  projectIds: string[],
): { cte: string; cteParams: unknown[]; clause: string; clauseParams: unknown[] } {
  const projectClause = projectIds.length
    ? `EXISTS (SELECT 1 FROM placed pl WHERE pl.task_id = t.id
                 AND pl.project_id IN (${projectIds.map(() => "?").join(",")}))`
    : `FALSE`;
  return {
    cte: `WITH RECURSIVE up AS (
       SELECT t.id AS task_id, t.id AS node_id, t.parent_task_id, 0 AS depth
       FROM core.tasks t WHERE t.org_id = ?
       UNION ALL
       SELECT u.task_id, p.id, p.parent_task_id, u.depth + 1
       FROM up u JOIN core.tasks p ON p.id = u.parent_task_id
       WHERE u.depth < 8
     ),
     placed AS (
       SELECT DISTINCT u.task_id, tp.project_id
       FROM up u JOIN core.task_projects tp ON tp.task_id = u.node_id
     ),
     mine AS (
       SELECT DISTINCT u.task_id
       FROM up u
       JOIN core.tasks n ON n.id = u.node_id
       LEFT JOIN core.task_assignees a ON a.task_id = u.node_id AND a.user_id = ?
       WHERE n.created_by = ? OR a.user_id IS NOT NULL
     ),
     followed AS (
       SELECT DISTINCT u.task_id
       FROM up u JOIN core.task_followers f ON f.task_id = u.node_id AND f.user_id = ?
     )`,
    cteParams: [ctx.orgId, ctx.user.id, ctx.user.id, ctx.user.id],
    // Подписка на задачу В ПРОЕКТЕ доступа не даёт (правило 4 в CLAUDE.md ядра):
    // иначе исключённый из проекта сохранял бы доступ через самоподписку.
    clause: `(
         ${projectClause}
         OR EXISTS (SELECT 1 FROM mine m WHERE m.task_id = t.id)
         OR (NOT EXISTS (SELECT 1 FROM placed pl2 WHERE pl2.task_id = t.id)
             AND EXISTS (SELECT 1 FROM followed f2 WHERE f2.task_id = t.id))
       )`,
    clauseParams: projectIds.length ? [projectIds] : [],
  };
}

/**
 * Отсев недоступных задач из готового списка id. Нужен каналам, которые
 * ссылаются на задачи в обход обычной проверки — например связям.
 */
export async function filterVisibleTaskIds(ctx: AuthContext, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const projects = await visibleProjectIds(ctx, { includeArchived: true });
  const vis = taskVisibility(ctx, projects);
  const rows = await prepare<{ id: string }>(
    `${vis.cte}
     SELECT t.id FROM core.tasks t
     WHERE t.org_id = ? AND t.id IN (${ids.map(() => "?").join(",")}) AND ${vis.clause}`,
  ).all(...vis.cteParams, ctx.orgId, ids, ...vis.clauseParams);
  return new Set(rows.map((r) => r.id));
}

/**
 * Задачи всех доступных проектов организации + личные — для сводного экрана.
 *
 * Видимость повторяет `loadTaskAccess`, но пакетно:
 *  - `up` поднимает каждую задачу по цепочке родителей (multi-homing наследуется);
 *  - задача в проекте видна при роли в любом проекте цепочки, авторстве или
 *    назначении где-то в цепочке;
 *  - «свободная» задача (нет размещений во всей цепочке) — ещё и подписчику.
 * Подписка на задачу В ПРОЕКТЕ доступа не даёт: см. правило 4 в CLAUDE.md ядра.
 */
export async function listAllTasks(
  ctx: AuthContext,
  opts: { includeDone?: boolean; includeArchivedProjects?: boolean } = {},
): Promise<AllTasksResult> {
  const projects = await visibleProjectIds(ctx, { includeArchived: opts.includeArchivedProjects });
  const vis = taskVisibility(ctx, projects);

  const rows = await prepare<Omit<CoreTask, "description">>(
    `${vis.cte}
     SELECT ${TASK_LIST_COLUMNS}
     FROM core.tasks t
     WHERE t.org_id = ?
       AND (?::boolean OR t.completed_at IS NULL)
       AND ${vis.clause}
     ORDER BY t.due_date NULLS LAST, t.created_at DESC
     LIMIT ?`,
    // Параметры — строго в порядке появления `?` в тексте запроса.
  ).all(
    ...vis.cteParams,
    ctx.orgId,
    opts.includeDone ?? false,
    ...vis.clauseParams,
    ALL_TASKS_CAP + 1,
  );

  const truncated = rows.length > ALL_TASKS_CAP;
  const page = truncated ? rows.slice(0, ALL_TASKS_CAP) : rows;
  const enriched = await enrichTasks(page);

  // Значения кастомных полей — одним запросом на весь экран: они играют роль
  // колонок, которые в v1 были зашиты в схему (категория, этап, участники).
  const valuesByTask = new Map<string, Record<string, unknown>>();
  if (page.length > 0) {
    const ph = page.map(() => "?").join(",");
    const values = await prepare<{ task_id: string; field_id: string; value: unknown }>(
      `SELECT task_id, field_id, value FROM core.task_field_values WHERE task_id IN (${ph})`,
    ).all(page.map((t) => t.id));
    for (const v of values) {
      const bucket = valuesByTask.get(v.task_id) ?? {};
      bucket[v.field_id] = v.value;
      valuesByTask.set(v.task_id, bucket);
    }
  }

  return {
    tasks: enriched.map((t) => ({ ...t, field_values: valuesByTask.get(t.id) ?? {} })),
    truncated,
  };
}

export async function listSubtasks(ctx: AuthContext, parentTaskId: string): Promise<TaskListItem[]> {
  await requireTaskAccess(ctx, parentTaskId, "view");
  const rows = await prepare<Omit<CoreTask, "description">>(
    `SELECT ${TASK_LIST_COLUMNS} FROM core.tasks t WHERE t.parent_task_id = ? ORDER BY t.created_at`,
  ).all(parentTaskId);
  return enrichTasks(rows);
}

export async function getTaskDetail(ctx: AuthContext, taskId: string): Promise<TaskDetail> {
  const access = await requireTaskAccess(ctx, taskId, "view");
  // Обвязка, подписчики, значения полей и автор независимы — берём параллельно.
  const [[meta], followers, values, creator] = await Promise.all([
    enrichTasks([access.task]),
    prepare<UserBrief>(
      `SELECT u.id, u.email, u.name, u.avatar_url
       FROM core.task_followers f JOIN core.users u ON u.id = f.user_id
       WHERE f.task_id = ? ORDER BY f.created_at`,
    ).all(taskId),
    prepare<{ field_id: string; value: unknown }>(
      `SELECT field_id, value FROM core.task_field_values WHERE task_id = ?`,
    ).all(taskId),
    access.task.created_by
      ? prepare<UserBrief>(`SELECT id, email, name, avatar_url FROM core.users WHERE id = ?`).get(access.task.created_by)
      : Promise.resolve(undefined),
  ]);
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
  for (const pl of placements) {
    await requireProject(ctx, pl.project_id, "task.create");
    if (pl.section_id) await assertSectionInProject(pl.section_id, pl.project_id);
  }

  let parentAccess: TaskAccess | undefined;
  if (input.parent_task_id) {
    parentAccess = await requireTaskAccess(ctx, input.parent_task_id, "edit");
  }

  // Задача вне проектов попадает в личный инбокс и может быть назначена коллеге —
  // гостю этот канал закрыт, иначе внешний подрядчик рассылает задачи всей org.
  // Подзадача наследует проекты родителя, поэтому «вне проектов» она только
  // тогда, когда и у родителя их нет.
  const inheritsProject = (parentAccess?.chainProjectIds.length ?? 0) > 0;
  if (placements.length === 0 && !inheritsProject) {
    assertOrg(ctx, "task.create.personal");
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
    // Расширять видимость задачи вправе только тот, кто сам редактор во всех
    // проектах, где она уже видна — включая проекты родителя (у подзадачи своих
    // размещений нет). Иначе исполнитель выносит подзадачу из приватного
    // проекта в свой и открывает её посторонним.
    for (const projectId of access.chainProjectIds) {
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
