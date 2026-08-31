// Единственное место, где живут правила доступа v2. Чистые функции без БД:
// всё, что нужно для решения, приходит в AuthContext + целевых объектах.
// Любая новая проверка прав добавляется сюда (и в policy.test.ts), а не в роуты.

import {
  type AuthContext,
  type OrgRole,
  type PolicyKbDocument,
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
  | "projects.order"      // порядок проектов в панели — общий для организации,
                          // поэтому и право на него org-уровня, а не проектного
  | "task.create.personal" // задача без проекта (личный инбокс) — не для гостей
  | "crm.view"           // CRM: воронки, сделки, клиенты — закрыто для гостей
  | "crm.manage"         // заводить и править сделки и клиентов
  | "crm.configure"      // воронки, этапы, справочники CRM
  | "kb.create.common"   // документ базы знаний без проекта («Общие») — не для гостей
  | "statuses.manage"     // справочники org-уровня (статусы задач)
  | "fields.manage"       // кастомные поля org-уровня
  | "tags.manage"
  | "audit.view"          // org-лента событий (фаза 3)
  | "settings.sections.manage"; // состав экрана настроек по ролям — только владелец

const MIN_ORG_ROLE: Record<OrgAction, OrgRole> = {
  "org.view": "guest",
  "org.update": "admin",
  "org.members.view": "guest",
  "org.members.manage": "admin",
  "org.invite": "admin",
  "org.delete": "owner",
  "project.create": "member",
  // Порядок в панели видит вся команда — двигает его тот, кто отвечает за
  // организацию, как и справочник статусов.
  "projects.order": "admin",
  "task.create.personal": "member",
  "crm.view": "member",
  "crm.manage": "member",
  // Воронка — рабочий процесс всей организации, как справочник статусов:
  // правит её тот, кто за организацию отвечает.
  "crm.configure": "admin",
  // Общий документ виден всей организации и живёт вне проектов — заводить его
  // может сотрудник, но не гость: у гостя нет своего контура вне проектов.
  "kb.create.common": "member",
  "statuses.manage": "admin",
  "fields.manage": "member",
  "tags.manage": "member",
  "audit.view": "admin",
  "settings.sections.manage": "owner",
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
  | "task.create"
  | "task.edit"               // поля, статус, исполнители, порядок в проекте
  | "task.delete"
  | "task.comment"
  | "doc.create"              // документ базы знаний в проекте, в т.ч. перенос
                              // чужого документа в этот проект
  | "sprint.manage"           // спринты проекта в режиме «Разработка»: завести,
                              // передвинуть даты, начать и завершить. Планирование
                              // работы — дело команды, а не администратора проекта,
                              // поэтому порог тот же, что у правки задач
  | "field.value.edit";       // значения кастомных полей на задачах проекта

const MIN_PROJECT_ROLE: Record<ProjectAction, ProjectRole> = {
  "project.view": "viewer",
  "project.update": "admin",
  "project.access": "admin",
  "project.archive": "admin",
  "project.delete": "admin",
  "project.members.manage": "admin",
  "task.create": "editor",
  "task.edit": "editor",
  "task.delete": "editor",
  "task.comment": "commenter",
  "doc.create": "editor",
  "sprint.manage": "editor",
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

// --- База знаний ----------------------------------------------------------------

export type KbAction =
  | "doc.view"
  | "doc.comment"
  | "doc.edit"       // текст, заголовок, место в дереве
  | "doc.delete"     // в корзину вместе с поддеревом
  | "doc.manage";    // доступ и привязка к проектам — только у корня ветки

const MIN_KB_ROLE: Record<KbAction, ProjectRole> = {
  "doc.view": "viewer",
  "doc.comment": "commenter",
  "doc.edit": "editor",
  "doc.delete": "editor",
  "doc.manage": "admin",
};

/**
 * Эффективная роль пользователя в документе базы знаний.
 *
 * У документа два взаимоисключающих источника доступа, и решает наличие
 * привязок к проектам у КОРНЯ ветки:
 *  - есть проекты → лучшая из ролей по ним (`effectiveProjectRole`). Список
 *    участников документа при этом не участвует вовсе: иначе закрытый проект
 *    открывался бы поимённой записью в документе;
 *  - проектов нет («общий» документ) → автор корня и владелец организации
 *    получают `admin`, дальше решает явная запись, а `default_role` раздаёт
 *    базовую роль сотрудникам. `default_role === null` — закрытый документ.
 *
 * Отличие от проектов намеренное: владелец организации видит закрытый общий
 * документ, хотя закрытый проект не видит. Настраивать доступ к такому
 * документу может именно он (второй после автора), а настраивать невидимое
 * нельзя. Кому нужен контур, закрытый и от владельца, — заводит закрытый проект.
 */
export function effectiveKbRole(ctx: AuthContext, doc: PolicyKbDocument): ProjectRole | null {
  if (doc.org_id !== ctx.orgId) return null;

  if (doc.projects.length > 0) {
    let best: ProjectRole | null = null;
    for (const project of doc.projects) {
      const role = effectiveProjectRole(ctx, project);
      if (role && (!best || PROJECT_ROLE_RANK[role] > PROJECT_ROLE_RANK[best])) best = role;
    }
    return best;
  }

  if (doc.created_by && doc.created_by === ctx.user.id) return "admin";
  if (ctx.orgRole === "owner") return "admin";
  if (doc.member_role) return doc.member_role;
  if (!doc.default_role) return null;
  // Базовая роль — только для сотрудников: гость внешний участник, его пускает
  // лишь явная запись (то же правило, что у проектов).
  if (ctx.orgRole === "guest") return null;
  if (ctx.orgRole === "admin") return "admin";
  return doc.default_role;
}

/**
 * Хватает ли уже посчитанной роли для действия. Отдельно от `canKb`, потому что
 * сервис считает роль один раз (три запроса) и дальше проверяет по ней: вывести
 * роль второй раз из усечённого среза документа — верный способ получить не ту.
 */
export function canKbRole(role: ProjectRole | null, action: KbAction): boolean {
  if (!role) return false;
  return PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK[MIN_KB_ROLE[action]];
}

export function canKb(ctx: AuthContext, action: KbAction, doc: PolicyKbDocument): boolean {
  return canKbRole(effectiveKbRole(ctx, doc), action);
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

export function assertKb(ctx: AuthContext, action: KbAction, doc: PolicyKbDocument): void {
  if (!canKb(ctx, action, doc)) throw new PolicyError(action);
}

export function assertKbRole(role: ProjectRole | null, action: KbAction): void {
  if (!canKbRole(role, action)) throw new PolicyError(action);
}
