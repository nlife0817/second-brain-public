// Доменные типы ядра (schema core).

export type OrgRole = "owner" | "admin" | "member" | "guest";
export type ProjectRole = "admin" | "editor" | "commenter" | "viewer";
export type ProjectVisibility = "org" | "private";
/**
 * Базовая роль проекта: её получает сотрудник организации без явной записи в
 * project_members. `null` — закрытый проект (только явные участники). «admin»
 * недоступен: иначе любой сотрудник менял бы настройки проекта и удалял его.
 */
export type ProjectDefaultRole = "viewer" | "commenter" | "editor";

export interface CoreUser {
  id: string;
  auth_user_id: string | null;
  email: string;
  name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

export interface OrgMemberWithUser extends OrgMember {
  email: string;
  name: string;
  avatar_url: string | null;
}

export interface ProjectGrant {
  project_id: string;
  role: ProjectRole;
}

export interface Invitation {
  id: string;
  org_id: string;
  email: string;
  org_role: OrgRole;
  project_grants: ProjectGrant[];
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
}

/** Контекст авторизованного запроса внутри организации. */
export interface AuthContext {
  user: CoreUser;
  orgId: string;
  orgRole: OrgRole;
  /** Явные роли пользователя в проектах этой организации (project_id → role). */
  projectRoles: ReadonlyMap<string, ProjectRole>;
}

/** Мини-срез проекта, достаточный для policy-решений. */
export interface PolicyProject {
  id: string;
  org_id: string;
  /** Источник истины доступа. `null` = закрытый проект (см. ProjectDefaultRole). */
  default_role: ProjectDefaultRole | null;
}

// --- Задачи и проекты -----------------------------------------------------------

export type TaskPriority = "urgent" | "high" | "medium" | "low" | "none";
export type StatusKind = "open" | "done" | "archived";
export type FieldType =
  | "text" | "number" | "select" | "multi_select" | "date" | "user" | "checkbox" | "url";

export interface UserBrief {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

export interface Project {
  id: string;
  org_id: string;
  team_id: string | null;
  name: string;
  description: string;
  color: string;
  icon: string;
  default_role: ProjectDefaultRole | null;
  /** Производная от `default_role` (generated-колонка): `private` ⇔ default_role is null. */
  visibility: ProjectVisibility;
  position: number;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithMeta extends Project {
  my_role: ProjectRole | null;
  open_task_count: number;
  /**
   * Явные участники закрытого проекта; `null` — проект открыт, и ограничений на
   * состав исполнителей он не накладывает. Нужен интерфейсу: закрытый проект
   * виден только своим, а назначение задачи само по себе её открывает.
   */
  member_ids: string[] | null;
}

export interface ProjectMemberWithUser {
  project_id: string;
  user_id: string;
  role: ProjectRole;
  email: string;
  name: string;
  avatar_url: string | null;
}

export interface TaskStatus {
  id: string;
  org_id: string;
  name: string;
  color: string;
  kind: StatusKind;
  position: number;
}

export interface CoreTag {
  id: string;
  org_id: string;
  name: string;
  color: string;
  position: number;
}

export interface FieldOption {
  id: string;
  label: string;
  color?: string;
}

export interface CustomField {
  id: string;
  org_id: string;
  project_id: string | null;
  name: string;
  type: FieldType;
  options: FieldOption[];
  position: number;
}

export interface TaskPlacement {
  project_id: string;
  position: number;
}

export interface CoreTask {
  id: string;
  org_id: string;
  title: string;
  description: string;
  status_id: string | null;
  priority: TaskPriority;
  due_date: string | null;
  due_time: string | null;
  estimated_minutes: number | null;
  completed_at: string | null;
  parent_task_id: string | null;
  source: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Обвязка задачи, общая для списков и карточки. */
export interface TaskMeta {
  assignees: UserBrief[];
  tags: CoreTag[];
  placements: TaskPlacement[];
  subtask_count: number;
  subtask_done_count: number;
  comment_count: number;
}

/**
 * Элемент списка (доска, «Мои задачи», подзадачи). Без `description`: HTML
 * описаний не рендерится ни на одной карточке, а в проекте на 700 задач это
 * четверть трафика ответа.
 */
export interface TaskListItem extends Omit<CoreTask, "description">, TaskMeta {}

/**
 * Строка сводного списка «Все задачи»: элемент списка + значения кастомных
 * полей. Поля нужны как колонки таблицы: организация задаёт свой набор
 * атрибутов вместо зашитых в схему.
 */
export interface TaskRow extends TaskListItem {
  field_values: Record<string, unknown>;
}

/** Ответ сводного списка: `truncated` честно сообщает об упёршемся лимите. */
export interface AllTasksResult {
  tasks: TaskRow[];
  truncated: boolean;
}

export interface TaskWithMeta extends CoreTask, TaskMeta {}

export interface TaskDetail extends TaskWithMeta {
  followers: UserBrief[];
  field_values: Record<string, unknown>;
  creator: UserBrief | null;
  /**
   * Проекты всей цепочки, включая родительские: у подзадачи своих размещений
   * нет, а закрытость она наследует от родителя. Карточка сужает по этому
   * списку выбор исполнителей — ровно как сервер в `updateTask`.
   */
  chain_project_ids: string[];
}

// --- Связи между сущностями ------------------------------------------------------

export type RelationEntityType = "task" | "client" | "project";

export interface RelationType {
  id: string;
  org_id: string;
  name: string;
  color: string;
  icon: string;
  position: number;
}

/** Связь глазами конкретной карточки: «дальняя» сторона уже разрешена. */
export interface RelationWithTarget {
  id: string;
  relation_type_id: string | null;
  /** outgoing — связь заведена из этой карточки, incoming — на неё сослались. */
  direction: "outgoing" | "incoming";
  entity_type: RelationEntityType;
  entity_id: string;
  title: string;
  color: string | null;
  created_at: string;
}

export interface CoreComment {
  id: string;
  org_id: string;
  entity_type: "task" | "project" | "client";
  entity_id: string;
  author_id: string | null;
  author_label: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  author: UserBrief | null;
}

// --- Документ описания: вложения и комментарии к тексту ---------------------------

/** Файл, вставленный в описание задачи. Байты живут в БД, здесь — только метаданные. */
export interface Attachment {
  id: string;
  org_id: string;
  task_id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  created_at: string;
  /** Готовый путь для `<img src>` / скачивания. */
  url: string;
}

/** Одно сообщение в треде комментариев к описанию (корень или ответ). */
export interface DocCommentMessage {
  id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  author: UserBrief | null;
}

/**
 * Тред комментариев к фрагменту описания. `id` треда совпадает с id корневого
 * сообщения и хранится в разметке как `<span data-comment="…">` — по нему
 * панель комментариев и текст находят друг друга.
 */
export interface DocCommentThread {
  id: string;
  task_id: string;
  quote: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  messages: DocCommentMessage[];
}

export interface CoreEvent {
  id: number;
  org_id: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  verb: string;
  payload: Record<string, unknown>;
  created_at: string;
  actor: UserBrief | null;
}

/**
 * Отношение уведомления к получателю: своя задача, подписка или всё остальное.
 * Считается на сервере — в браузере нет ни списка исполнителей, ни подписок.
 */
export type NotificationScope = "mine" | "subscribed" | "other";

export interface CoreNotification {
  id: string;
  org_id: string;
  kind: string;
  read_at: string | null;
  created_at: string;
  verb: string | null;
  payload: Record<string, unknown> | null;
  actor_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_title: string | null;
  scope: NotificationScope;
}

export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  guest: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
  admin: 3,
};
