// Единственное место, где живут правила доступа v2. Чистые функции без БД:
// всё, что нужно для решения, приходит в AuthContext + целевых объектах.
// Любая новая проверка прав добавляется сюда (и в policy.test.ts), а не в роуты.

import {
  type AuthContext,
  type OrgRole,
  type PolicyProject,
  type ProjectRole,
  ORG_ROLE_RANK,
  PROJECT_ROLE_RANK,
} from "./types";

// --- Действия уровня организации ---------------------------------------------

export type OrgAction =
  | "org.view"            // видеть организацию (имя, свой состав ролей)
  | "org.update"          // переименование, настройки
  | "org.members.view"    // список участников
  | "org.members.manage"  // смена ролей, удаление участников
  | "org.invite"          // приглашения (в т.ч. гостей)
  | "org.delete"
  | "project.create"
  | "task.create.personal" // задача без проекта (личный инбокс) — не для гостей
  | "clients.view"        // CRM закрыт для гостей
  | "clients.manage"
  | "statuses.manage"     // справочники org-уровня (статусы задач)
  | "fields.manage"       // кастомные поля org-уровня
  | "tags.manage"
  | "audit.view";         // org-лента событий (фаза 3)

const MIN_ORG_ROLE: Record<OrgAction, OrgRole> = {
  "org.view": "guest",
  "org.update": "admin",
  "org.members.view": "guest",
  "org.members.manage": "admin",
  "org.invite": "admin",
  "org.delete": "owner",
  "project.create": "member",
  "task.create.personal": "member",
  "clients.view": "member",
  "clients.manage": "member",
  "statuses.manage": "admin",
  "fields.manage": "member",
  "tags.manage": "member",
  "audit.view": "admin",
};

export function canOrg(ctx: AuthContext, action: OrgAction): boolean {
  return ORG_ROLE_RANK[ctx.orgRole] >= ORG_ROLE_RANK[MIN_ORG_ROLE[action]];
}

// --- Действия уровня проекта --------------------------------------------------

export type ProjectAction =
  | "project.view"
  | "project.update"          // имя, цвет, иконка, описание
  | "project.access"           // базовая роль организации (в т.ч. закрытие проекта):
                               // только не-гости, иначе гость закрывает проект
                               // организации и запирает в нём её же сотрудников
  | "project.archive"
  | "project.delete"
  | "project.members.manage"
  | "section.manage"
  | "task.create"
  | "task.edit"               // поля, статус, исполнители, перенос между секциями
  | "task.delete"
  | "task.comment"
  | "field.value.edit";       // значения кастомных полей на задачах проекта

const MIN_PROJECT_ROLE: Record<ProjectAction, ProjectRole> = {
  "project.view": "viewer",
  "project.update": "admin",
  "project.access": "admin",
  "project.archive": "admin",
  "project.delete": "admin",
  "project.members.manage": "admin",
  "section.manage": "editor",
  "task.create": "editor",
  "task.edit": "editor",
  "task.delete": "editor",
  "task.comment": "commenter",
  "field.value.edit": "editor",
};

/**
 * Эффективная роль пользователя в проекте. Доступ сотрудника задаётся настройками
 * самого проекта — полем `default_role`:
 *  - закрытый проект (`default_role === null`) видят ТОЛЬКО явные участники —
 *    org owner/admin не имеют имплицитного доступа (защита личного контура);
 *  - иначе owner/admin → admin, member → `default_role`, а явная запись в
 *    project_members выигрывает у базовой роли (в обе стороны);
 *  - guest: только явная запись, базовая роль на него не распространяется —
 *    внешний подрядчик не сотрудник организации.
 */
export function effectiveProjectRole(ctx: AuthContext, project: PolicyProject): ProjectRole | null {
  if (project.org_id !== ctx.orgId) return null;
  const explicit = ctx.projectRoles.get(project.id) ?? null;
  if (!project.default_role) return explicit;
  if (ctx.orgRole === "owner" || ctx.orgRole === "admin") return "admin";
  if (explicit) return explicit;
  if (ctx.orgRole === "member") return project.default_role;
  return null;
}

export function canProject(ctx: AuthContext, action: ProjectAction, project: PolicyProject): boolean {
  const role = effectiveProjectRole(ctx, project);
  if (!role) return false;
  // Гость — всегда внешний участник: доступом сотрудников к проекту не управляет.
  if (action === "project.access" && ctx.orgRole === "guest") return false;
  return PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK[MIN_PROJECT_ROLE[action]];
}

// --- Задачи вне проектов (личный инбокс) ---------------------------------------

export interface LooseTaskAccess {
  isCreator: boolean;
  isAssignee: boolean;
  isFollower: boolean;
}

/**
 * Задача, не прикреплённая ни к одному проекту, видна создателю, исполнителям
 * и подписчикам; редактируют её создатель и исполнители.
 */
export function canViewLooseTask(a: LooseTaskAccess): boolean {
  return a.isCreator || a.isAssignee || a.isFollower;
}

export function canEditLooseTask(a: LooseTaskAccess): boolean {
  return a.isCreator || a.isAssignee;
}

// --- Ошибка и assert-хелперы ----------------------------------------------------

export class PolicyError extends Error {
  readonly status = 403;
  constructor(action: string) {
    super(`Forbidden: ${action}`);
    this.name = "PolicyError";
  }
}

export function assertOrg(ctx: AuthContext, action: OrgAction): void {
  if (!canOrg(ctx, action)) throw new PolicyError(action);
}

export function assertProject(ctx: AuthContext, action: ProjectAction, project: PolicyProject): void {
  if (!canProject(ctx, action, project)) throw new PolicyError(action);
}
