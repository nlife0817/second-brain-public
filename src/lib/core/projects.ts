// Доменный сервис проектов: список с учётом видимости, CRUD, секции, участники.

import { prepare, transaction, type TxContext } from "@/lib/sql";
import { emitEvent, notifyUsers } from "./events";
import { DomainError } from "./http";
import {
  assertOrg,
  assertProject,
  effectiveProjectRole,
  type ProjectAction,
} from "./policy";
import type {
  AuthContext,
  Project,
  ProjectDefaultRole,
  ProjectMemberWithUser,
  ProjectRole,
  ProjectWithMeta,
  Section,
} from "./types";

// --- Загрузка и проверка --------------------------------------------------------

export async function getProject(projectId: string): Promise<Project | undefined> {
  return prepare<Project>(`SELECT * FROM core.projects WHERE id = ?`).get(projectId);
}

/** Проект организации ctx с проверкой права; 404 если чужой/нет/не виден. */
export async function requireProject(
  ctx: AuthContext,
  projectId: string,
  action: ProjectAction,
): Promise<Project> {
  const project = await getProject(projectId);
  if (!project || project.org_id !== ctx.orgId) throw new DomainError(404, "Project not found");
  // Невидимый проект неотличим от несуществующего.
  if (!effectiveProjectRole(ctx, project)) throw new DomainError(404, "Project not found");
  assertProject(ctx, action, project);
  return project;
}

// --- Списки ----------------------------------------------------------------------

export async function listProjects(ctx: AuthContext, opts: { archived?: boolean } = {}): Promise<ProjectWithMeta[]> {
  const all = await prepare<Project>(
    `SELECT * FROM core.projects
     WHERE org_id = ? AND (archived_at IS NULL) = (?::boolean IS FALSE)
     ORDER BY position, created_at`,
  ).all(ctx.orgId, opts.archived ?? false);

  // Видимость решает policy — единственный источник истины.
  const visible = all.filter((p) => effectiveProjectRole(ctx, p) !== null);
  if (visible.length === 0) return [];

  const placeholders = visible.map(() => "?").join(",");
  const counts = await prepare<{ project_id: string; n: number }>(
    `SELECT tp.project_id, count(*)::int AS n
     FROM core.task_projects tp
     JOIN core.tasks t ON t.id = tp.task_id
     WHERE tp.project_id IN (${placeholders}) AND t.completed_at IS NULL
     GROUP BY tp.project_id`,
  ).all(visible.map((p) => p.id));
  const countMap = new Map(counts.map((c) => [c.project_id, c.n]));

  // Состав участников тянем только у закрытых проектов: только там он что-то
  // ограничивает, а открытых в организации обычно на порядок больше.
  const closed = visible.filter((p) => !p.default_role);
  const memberMap = new Map<string, string[]>();
  if (closed.length > 0) {
    const closedPh = closed.map(() => "?").join(",");
    const rows = await prepare<{ project_id: string; user_id: string }>(
      `SELECT project_id, user_id FROM core.project_members WHERE project_id IN (${closedPh})`,
    ).all(closed.map((p) => p.id));
    for (const row of rows) {
      const list = memberMap.get(row.project_id);
      if (list) list.push(row.user_id);
      else memberMap.set(row.project_id, [row.user_id]);
    }
  }

  return visible.map((p) => ({
    ...p,
    my_role: effectiveProjectRole(ctx, p),
    open_task_count: countMap.get(p.id) ?? 0,
    member_ids: p.default_role ? null : (memberMap.get(p.id) ?? []),
  }));
}

// --- CRUD -------------------------------------------------------------------------

export async function createProject(
  ctx: AuthContext,
  input: {
    name: string;
    description?: string;
    color?: string;
    icon?: string;
    /** Базовая роль сотрудников; `null` — закрытый проект. По умолчанию закрытый. */
    default_role?: ProjectDefaultRole | null;
  },
): Promise<ProjectWithMeta> {
  assertOrg(ctx, "project.create");
  // Гость не может создать проект (project.create), поэтому проверка
  // «доступом организации управляют только сотрудники» здесь избыточна.
  const project = await transaction(async (tx) => {
    const row = await tx
      .prepare<Project>(
        // visibility — generated-колонка, она вычисляется из default_role.
        `INSERT INTO core.projects (org_id, name, description, color, icon, default_role, position, created_by)
         VALUES (?, ?, ?, ?, ?, ?,
                 COALESCE((SELECT max(position) + 1 FROM core.projects WHERE org_id = ?), 1),
                 ?)
         RETURNING *`,
      )
      .get(
        ctx.orgId,
        input.name,
        input.description ?? "",
        input.color ?? "#6b7280",
        input.icon ?? "Folder",
        // Умолчание — закрытый проект: доступ всей организации открывают явно.
        input.default_role ?? null,
        ctx.orgId,
        ctx.user.id,
      );
    if (!row) throw new DomainError(500, "Failed to create project");
    await tx
      .prepare(`INSERT INTO core.project_members (project_id, user_id, role) VALUES (?, ?, 'admin')`)
      .run(row.id, ctx.user.id);
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "project",
      entityId: row.id,
      verb: "project.created",
      payload: { name: row.name },
    });
    return row;
  });
  // Автор закрытого проекта — его единственный участник (запись выше).
  return {
    ...project,
    my_role: "admin",
    open_task_count: 0,
    member_ids: project.default_role ? null : [ctx.user.id],
  };
}

export async function updateProject(
  ctx: AuthContext,
  projectId: string,
  patch: Partial<{
    name: string;
    description: string;
    color: string;
    icon: string;
    default_role: ProjectDefaultRole | null;
    position: number;
  }>,
): Promise<Project> {
  const project = await requireProject(ctx, projectId, "project.update");
  const accessChanged = patch.default_role !== undefined && patch.default_role !== project.default_role;
  if (accessChanged) assertProject(ctx, "project.access", project);
  const next = { ...project, ...patch };
  const updated = await transaction(async (tx) => {
    // Закрытие проекта: закрытый проект живёт только на явных участниках, поэтому
    // гарантируем хотя бы одного admin — иначе проект осиротеет безвозвратно.
    if (accessChanged && patch.default_role === null) {
      if (project.default_role) {
        await preserveAssigneesOnClose(tx, projectId, ctx.orgId, project.default_role);
      }
      const admins = await tx
        .prepare<{ n: number }>(
          `SELECT count(*)::int AS n FROM core.project_members WHERE project_id = ? AND role = 'admin'`,
        )
        .get(projectId);
      if ((admins?.n ?? 0) === 0) {
        await tx
          .prepare(
            `INSERT INTO core.project_members (project_id, user_id, role) VALUES (?, ?, 'admin')
             ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'admin'`,
          )
          .run(projectId, ctx.user.id);
      }
    }
    const row = await tx
      .prepare<Project>(
        `UPDATE core.projects
         SET name = ?, description = ?, color = ?, icon = ?, default_role = ?, position = ?
         WHERE id = ?
         RETURNING *`,
      )
      .get(next.name, next.description, next.color, next.icon, next.default_role, next.position, projectId);
    if (!row) throw new DomainError(500, "Failed to update project");
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "project",
      entityId: projectId,
      verb: "project.updated",
      payload: { fields: Object.keys(patch) },
    });
    return row;
  });
  return updated;
}

/**
 * Закрытие проекта отбирает доступ у всех сотрудников без явной записи — включая
 * тех, на кого назначены задачи этого проекта. Исполнитель всё равно сохранил бы
 * доступ к своим задачам через `task_assignees`, поэтому вместо невидимого
 * «остаточного» доступа фиксируем таких людей явными участниками: список
 * участников снова описывает всех, кто видит проект, а лишних админ убирает
 * оттуда одним действием (и тогда `removeProjectMember` снимет назначения).
 *
 * Подписчиков не переносим: подписка доступа к задаче в проекте не даёт
 * (правило 4 в core/CLAUDE.md), гостей — тоже: они и так только по явной записи.
 */
async function preserveAssigneesOnClose(
  tx: TxContext,
  projectId: string,
  orgId: string,
  previousDefaultRole: ProjectDefaultRole,
): Promise<void> {
  await tx
    .prepare(
      `INSERT INTO core.project_members (project_id, user_id, role)
       SELECT DISTINCT tp.project_id,
              a.user_id,
              (CASE WHEN m.role IN ('owner','admin') THEN 'admin' ELSE ? END)::core.project_role
       FROM core.task_assignees a
       JOIN core.task_projects tp ON tp.task_id = a.task_id
       JOIN core.org_members m ON m.user_id = a.user_id AND m.org_id = ?
       WHERE tp.project_id = ? AND m.role <> 'guest'
       ON CONFLICT (project_id, user_id) DO NOTHING`,
    )
    .run(previousDefaultRole, orgId, projectId);
}

/**
 * Удаление проекта. Задачи не трогаем: при multi-homing задача может лежать и в
 * других проектах, а оставшиеся без размещений возвращаются авторам в инбокс —
 * потеря данных здесь была бы необратимой. Каскадом уходят участники, секции,
 * размещения и кастомные поля проекта; связи полиморфные, их чистим руками.
 */
export async function deleteProject(ctx: AuthContext, projectId: string): Promise<void> {
  const project = await requireProject(ctx, projectId, "project.delete");
  await transaction(async (tx) => {
    await tx
      .prepare(
        `DELETE FROM core.relations
         WHERE org_id = ?
           AND ((source_type = 'project' AND source_id = ?) OR (target_type = 'project' AND target_id = ?))`,
      )
      .run(ctx.orgId, projectId, projectId);
    // Событие пишем до удаления: emitEvent ссылается на org, а не на проект,
    // но лента должна получить имя удалённого проекта.
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "project",
      entityId: projectId,
      verb: "project.deleted",
      payload: { name: project.name },
    });
    await tx.prepare(`DELETE FROM core.projects WHERE id = ? AND org_id = ?`).run(projectId, ctx.orgId);
  });
}

export async function setProjectArchived(ctx: AuthContext, projectId: string, archived: boolean): Promise<void> {
  await requireProject(ctx, projectId, "project.archive");
  await transaction(async (tx) => {
    await tx
      .prepare(`UPDATE core.projects SET archived_at = ${archived ? "now()" : "NULL"} WHERE id = ?`)
      .run(projectId);
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "project",
      entityId: projectId,
      verb: archived ? "project.archived" : "project.unarchived",
    });
  });
}

// --- Секции ------------------------------------------------------------------------

export async function listSections(projectId: string): Promise<Section[]> {
  return prepare<Section>(
    `SELECT * FROM core.sections WHERE project_id = ? ORDER BY position, created_at`,
  ).all(projectId);
}

export async function createSection(ctx: AuthContext, projectId: string, name: string): Promise<Section> {
  await requireProject(ctx, projectId, "section.manage");
  const row = await prepare<Section>(
    `INSERT INTO core.sections (project_id, name, position)
     VALUES (?, ?, COALESCE((SELECT max(position) + 1 FROM core.sections WHERE project_id = ?), 1))
     RETURNING *`,
  ).get(projectId, name, projectId);
  if (!row) throw new DomainError(500, "Failed to create section");
  return row;
}

export async function updateSection(
  ctx: AuthContext,
  projectId: string,
  sectionId: string,
  patch: Partial<{ name: string; position: number }>,
): Promise<Section> {
  await requireProject(ctx, projectId, "section.manage");
  const current = await prepare<Section>(`SELECT * FROM core.sections WHERE id = ? AND project_id = ?`).get(sectionId, projectId);
  if (!current) throw new DomainError(404, "Section not found");
  const next = { ...current, ...patch };
  const row = await prepare<Section>(
    `UPDATE core.sections SET name = ?, position = ? WHERE id = ? RETURNING *`,
  ).get(next.name, next.position, sectionId);
  if (!row) throw new DomainError(500, "Failed to update section");
  return row;
}

export async function deleteSection(ctx: AuthContext, projectId: string, sectionId: string): Promise<void> {
  await requireProject(ctx, projectId, "section.manage");
  const changed = await prepare(`DELETE FROM core.sections WHERE id = ? AND project_id = ?`).run(sectionId, projectId);
  if (changed.changes === 0) throw new DomainError(404, "Section not found");
}

// --- Участники проекта ----------------------------------------------------------------

export async function listProjectMembers(projectId: string): Promise<ProjectMemberWithUser[]> {
  return prepare<ProjectMemberWithUser>(
    `SELECT pm.project_id, pm.user_id, pm.role, u.email, u.name, u.avatar_url
     FROM core.project_members pm
     JOIN core.users u ON u.id = pm.user_id
     WHERE pm.project_id = ?
     ORDER BY u.name, u.email`,
  ).all(projectId);
}

/** Проект не должен остаться без явного администратора (см. removeProjectMember). */
async function assertNotLastProjectAdmin(projectId: string, userId: string): Promise<void> {
  const targetRole = await prepare<{ role: ProjectRole }>(
    `SELECT role FROM core.project_members WHERE project_id = ? AND user_id = ?`,
  ).get(projectId, userId);
  if (targetRole?.role !== "admin") return;
  const admins = await prepare<{ n: number }>(
    `SELECT count(*)::int AS n FROM core.project_members WHERE project_id = ? AND role = 'admin'`,
  ).get(projectId);
  if ((admins?.n ?? 0) <= 1) {
    throw new DomainError(409, "Project must keep at least one admin");
  }
}

export async function upsertProjectMember(
  ctx: AuthContext,
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<void> {
  const project = await requireProject(ctx, projectId, "project.members.manage");
  const target = await prepare<{ user_id: string }>(
    `SELECT user_id FROM core.org_members WHERE org_id = ? AND user_id = ?`,
  ).get(ctx.orgId, userId);
  if (!target) throw new DomainError(422, "User is not a member of this organization");
  if (role !== "admin") await assertNotLastProjectAdmin(projectId, userId);

  await transaction(async (tx) => {
    const existing = await tx
      .prepare<{ role: ProjectRole }>(`SELECT role FROM core.project_members WHERE project_id = ? AND user_id = ?`)
      .get(projectId, userId);
    await tx
      .prepare(
        `INSERT INTO core.project_members (project_id, user_id, role)
         VALUES (?, ?, ?)
         ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      )
      .run(projectId, userId, role);
    if (!existing) {
      const eventId = await emitEvent(tx, {
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        entityType: "project",
        entityId: projectId,
        verb: "project.member_added",
        payload: { user_id: userId, role, project_name: project.name },
      });
      await notifyUsers(tx, {
        orgId: ctx.orgId,
        eventId,
        kind: "added_to_project",
        userIds: [userId],
        excludeUserId: ctx.user.id,
      });
    }
  });
}

export async function removeProjectMember(ctx: AuthContext, projectId: string, userId: string): Promise<void> {
  const project = await requireProject(ctx, projectId, "project.members.manage");
  // Последнего admin не удаляем при любом доступе: в закрытом проекте org-админ
  // не имеет неявного доступа, а в открытом проект остался бы без хозяина.
  await assertNotLastProjectAdmin(projectId, userId);

  await transaction(async (tx) => {
    const changed = await tx
      .prepare(`DELETE FROM core.project_members WHERE project_id = ? AND user_id = ?`)
      .run(projectId, userId);
    if (changed.changes === 0) throw new DomainError(404, "Member not found");

    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "project",
      entityId: projectId,
      verb: "project.member_removed",
      payload: { user_id: userId },
    });
  });

  // Если после удаления доступ к проекту всё равно остаётся (у проекта есть
  // базовая роль и человек — сотрудник), назначения и подписки трогать нельзя:
  // иначе снятие лишней явной роли молча стирает его задачи. Чистим только при
  // реальной потере доступа — у гостей и в закрытых проектах.
  await revokeProjectTaskLinks(projectId, userId, project.org_id, project.default_role);
}

/** Снимает назначения и подписки по задачам проекта, если доступ действительно утрачен. */
async function revokeProjectTaskLinks(
  projectId: string,
  userId: string,
  orgId: string,
  defaultRole: ProjectDefaultRole | null,
): Promise<void> {
  if (defaultRole) {
    const membership = await prepare<{ role: string }>(
      `SELECT role FROM core.org_members WHERE org_id = ? AND user_id = ?`,
    ).get(orgId, userId);
    const stillSees = membership && membership.role !== "guest";
    if (stillSees) return;
  }

  await transaction(async (tx) => {
    // Подзадачи собственных размещений не имеют — снимаем по всей ветке.
    const scope = `
      WITH RECURSIVE roots AS (
        SELECT tp.task_id FROM core.task_projects tp WHERE tp.project_id = ?
        UNION
        SELECT t.id FROM core.tasks t JOIN roots r ON t.parent_task_id = r.task_id
      )`;
    await tx
      .prepare(
        `${scope}
         DELETE FROM core.task_followers f USING roots r
         WHERE f.task_id = r.task_id AND f.user_id = ?`,
      )
      .run(projectId, userId);
    await tx
      .prepare(
        `${scope}
         DELETE FROM core.task_assignees a USING roots r
         WHERE a.task_id = r.task_id AND a.user_id = ?`,
      )
      .run(projectId, userId);
  });
}
