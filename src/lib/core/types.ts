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
  /** Задан ли пароль. Владельцу видно, кому ещё нужна ссылка установки. */
  has_password: boolean;
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

/**
 * Режим токена доступа. `read` не даёт новых прав, а сужает права владельца до
 * чтения: такой токен не допускается ни до одной мутации.
 */
export type ApiTokenScope = "read" | "full";

/** Токен доступа без самого значения — его показывают ровно один раз, при выпуске. */
export interface ApiToken {
  id: string;
  org_id: string;
  user_id: string;
  name: string;
  /** Первые символы значения — опознать строку в списке. */
  prefix: string;
  scope: ApiTokenScope;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
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

/**
 * Категория статуса. Задаёт и поведение (`done` проставляет completed_at,
 * `archived` прячет задачу из списков), и раскладку справочника в настройках.
 * Пришла на смену колонке `kind`, которая до следующего выката остаётся в БД
 * живым зеркалом под триггером ради уже загруженных вкладок — см.
 * 0041_core_status_categories.sql.
 */
export type StatusCategory = "backlog" | "in_progress" | "done" | "archived";
export type FieldType =
  | "text" | "number" | "select" | "multi_select" | "date" | "user" | "checkbox" | "url";

export interface UserBrief {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

/**
 * Режим проекта. `dev` добавляет к обычным видам спринты и бэклог; на модель
 * задач не влияет — задача остаётся той же во всех проектах, где размещена.
 */
export type ProjectMode = "standard" | "dev";

export interface Project {
  id: string;
  org_id: string;
  team_id: string | null;
  name: string;
  description: string;
  color: string;
  icon: string;
  mode: ProjectMode;
  /**
   * Набор статусов проекта; `null` — набор организации по умолчанию. Проект с
   * чужим набором не запрещает задачам иметь другой статус (задача живёт сразу
   * в нескольких проектах) — набор решает, что показывать.
   */
  status_set_id: string | null;
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

/**
 * Набор статусов — рабочий процесс, который проект выбирает себе целиком.
 * Организация всегда имеет ровно один набор по умолчанию: в него попадают
 * проекты, которые своего не выбирали.
 */
export interface StatusSet {
  id: string;
  org_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskStatus {
  id: string;
  org_id: string;
  /**
   * Набор, которому принадлежит статус. Инварианты справочника (ровно один
   * дефолт, непустые обязательные категории, позиции 1..N) действуют в границах
   * набора, а не организации.
   */
  set_id: string;
  name: string;
  color: string;
  category: StatusCategory;
  /** Статус новой задачи. Ровно один на набор, удалить его нельзя. */
  is_default: boolean;
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
  /**
   * Начало работ — левая граница полосы на ганте. Порядок относительно
   * `due_date` не навязан: план с началом позже срока пользователь видит и
   * правит сам.
   */
  start_date: string | null;
  /**
   * Во сколько начинается. Пустое время означает «весь день» — как и пустой
   * `due_time` означает срок на день целиком, а не на 00:00. Пара
   * `start_time`/`due_time` делает задачу отрезком внутри дня: именно ею
   * календарь ставит её в часовую сетку, а гант её не смотрит вовсе — он
   * считает в днях.
   */
  start_time: string | null;
  due_date: string | null;
  due_time: string | null;
  estimated_minutes: number | null;
  completed_at: string | null;
  parent_task_id: string | null;
  /**
   * Место среди подзадач своего родителя — порядок, заданный перетаскиванием.
   * У задачи верхнего уровня смысла не имеет и остаётся пустым; пустым оно
   * бывает и у подзадачи, созданной кодом до миграции 0049, — такая уходит в
   * конец ветки, а не ломает порядок остальных.
   */
  subtask_position: number | null;
  /**
   * Спринт, в который задача взята; `null` — бэклог. Спринт принадлежит проекту,
   * а задача бывает размещена сразу в нескольких, поэтому принадлежность
   * проверяет сервис: проект спринта обязан быть в цепочке размещений задачи.
   */
  sprint_id: string | null;
  /**
   * Сколько раз задача не поместилась в завершаемый спринт. Растёт только при
   * завершении спринта; перепланирование до старта переездом не считается.
   */
  sprint_carry_count: number;
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

// --- Спринты (режим проекта «Разработка») ------------------------------------------

/**
 * Состояние спринта. Путь односторонний: `planned → active → completed`.
 * Вернуть завершённый спринт в работу нельзя — незакрытые задачи из него уже
 * разъехались, и «возврат» означал бы собрать их обратно неизвестно откуда.
 */
export type SprintState = "planned" | "active" | "completed";

export interface Sprint {
  id: string;
  org_id: string;
  project_id: string;
  name: string;
  goal: string;
  starts_on: string | null;
  ends_on: string | null;
  state: SprintState;
  /** Ёмкость в минутах — та же единица, что `estimated_minutes` у задачи. */
  capacity_minutes: number | null;
  position: number;
  started_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Спринт с итогами по своим задачам. Считаются одним запросом на список: экран
 * планирования показывает «набрано / ёмкость» у каждого спринта, и запрос на
 * спринт означал бы N+1 при открытии экрана.
 */
export interface SprintWithTotals extends Sprint {
  task_count: number;
  done_count: number;
  /** Сумма оценок задач спринта; задачи без оценки в неё не попадают. */
  estimated_minutes: number;
  /** Сколько задач спринта остались без оценки — «набрано» на них не отвечает. */
  unestimated_count: number;
}

// --- Связи между сущностями ------------------------------------------------------

export type RelationEntityType = "task" | "client" | "project";

/**
 * Смысл типа связи. `generic` — произвольный ярлык («см. также»), `blocks` —
 * настоящая зависимость: источник блокирует цель. Гант рисует стрелки только по
 * второму: по одному лишь имени типа отличить зависимость от заметки нельзя.
 */
export type RelationKind = "generic" | "blocks";

export interface RelationType {
  id: string;
  org_id: string;
  name: string;
  color: string;
  icon: string;
  kind: RelationKind;
  position: number;
}

/**
 * Зависимость между задачами для ганта: `from` блокирует `to`. Плоская пара
 * без обвязки — полотну от связи нужны только два конца, а заголовки у него уже
 * есть в строках.
 */
export interface TaskDependency {
  from: string;
  to: string;
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
  /**
   * Корень обсуждения; null — сам корень. Уровень ровно один: ответ на ответ
   * сервер приводит к тому же корню (как в core.doc_comments).
   */
  parent_id: string | null;
  /** Канал, которым оставлен комментарий: null — интерфейс, иначе метка интеграции. */
  source: string | null;
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
  /**
   * Канал, которым сделано действие: null — руками в интерфейсе, иначе метка
   * интеграции (`claude`). Подпись для интерфейса даёт `actorSourceLabel`.
   */
  source: string | null;
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
  /** Канал действия, породившего уведомление. У напоминания события нет — null. */
  source: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_title: string | null;
  scope: NotificationScope;
}

// --- Внешние календари ---------------------------------------------------------------

/**
 * Подключения принадлежат пользователю, а не организации (миграция 0046):
 * личный календарь один и тот же во всех организациях, где человек состоит, а
 * привязка к тенанту означала бы, что его встречи видит чужой администратор.
 */
export type CalendarProvider = "google" | "ics";

/** Календарь внутри подключения. Секретов здесь нет — эти поля уходят в API. */
export interface CalendarBrief {
  id: string;
  account_id: string;
  name: string;
  /** Цвет из внешнего календаря. */
  color: string | null;
  /** Свой цвет вместо внешнего: палитра Google с нашей темой не согласована. */
  color_override: string | null;
  timezone: string | null;
  visible: boolean;
  last_sync_at: string | null;
}

export interface CalendarAccountWithCalendars {
  id: string;
  provider: CalendarProvider;
  /** Адрес аккаунта Google или хост ICS-ссылки — сама ссылка наружу не идёт. */
  label: string;
  sync_error: string | null;
  last_sync_at: string | null;
  created_at: string;
  calendars: CalendarBrief[];
}

/**
 * Событие внешнего календаря. Ровно одно из двух представлений заполнено —
 * это держит `calendar_events_span` в миграции 0046:
 *
 *  * `all_day` — дни включительно (`start_date`/`end_date`);
 *  * иначе — моменты (`starts_at`/`ends_at`), которые в местные день и время
 *    переводит `localPoint` из `calendar.ts`, и только в браузере.
 */
export interface CalendarEventRow {
  id: string;
  calendar_id: string;
  title: string;
  description: string | null;
  location: string | null;
  all_day: boolean;
  start_date: string | null;
  end_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: string | null;
  organizer: string | null;
  html_link: string | null;
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
