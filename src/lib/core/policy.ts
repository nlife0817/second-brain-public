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
  | "project.update"          // имя, цвет, видимость
  | "project.archive"
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
  "project.archive": "admin",
  "project.members.manage": "admin",
  "section.manage": "editor",
  "task.create": "editor",
  "task.edit": "editor",
  "task.delete": "editor",
  "task.comment": "commenter",
  "field.value.edit": "editor",
};

/**
 * Эффективная роль пользователя в проекте:
 *  - org owner/admin → project admin везде;
 *  - явная запись в project_members выигрывает у дефолта (в обе стороны);
 *  - member без явной записи: editor в org-видимых проектах, нет доступа в приватных;
 *  - guest: только явная запись.
 */
export function effectiveProjectRole(ctx: AuthContext, project: PolicyProject): ProjectRole | null {
  if (project.org_id !== ctx.orgId) return null;
  if (ctx.orgRole === "owner" || ctx.orgRole === "admin") return "admin";
  const explicit = ctx.projectRoles.get(project.id) ?? null;
  if (explicit) return explicit;
  if (ctx.orgRole === "member" && project.visibility === "org") return "editor";
  return null;
}

export function canProject(ctx: AuthContext, action: ProjectAction, project: PolicyProject): boolean {
  const role = effectiveProjectRole(ctx, project);
  if (!role) return false;
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
