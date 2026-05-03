// --- Users & Auth ---

export type UserRole = "admin" | "manager";

export interface User {
  email: string;
  role: UserRole;
  name: string;
  created_at: string;
  updated_at: string;
}

// --- Items ---

export type ItemType = "task" | "note" | "meeting" | "plan" | "idea";
export type ItemStatus = "inbox" | "todo" | "in_progress" | "review" | "done" | "archived";
export type ItemPriority = "urgent" | "high" | "medium" | "low" | "none";
export type ItemCategory = string;

export type ItemSource = "kaiten" | "system" | "claude";

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  position: number;
}
export type ViewMode = "kanban" | "list" | "weekly";
export type SubtaskDisplayMode = "inline" | "accordion" | "detached";
export type ListGroupByField = "none" | "status" | "priority" | "category" | "type" | "development_stage" | "participants" | "clients" | "estimated_minutes";
export type ListGroupByConfig = [ListGroupByField, ListGroupByField];

export type FilterOperator = "is" | "is_not" | "contains" | "not_contains" | "before" | "after" | "is_today" | "is_this_week" | "is_empty" | "is_not_empty";
export type FilterField = "status" | "priority" | "category" | "type" | "tags" | "title" | "description" | "due_date" | "has_parent" | "development_stage" | "participants";
export type FilterLogic = "and" | "or";

export interface DevelopmentParticipant {
  id: string;
  provider: "kaiten" | null;
  remote_id: string | null;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface DevelopmentParticipantInput {
  provider?: "kaiten" | null;
  remote_id?: string | null;
  name: string;
}

export interface FilterCondition {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  value: string;
}

export interface FilterGroup {
  id: string;
  logic: FilterLogic;
  conditions: FilterCondition[];
}

export interface Item {
  id: string;
  title: string;
  description: string;
  type: ItemType;
  status: ItemStatus;
  priority: ItemPriority;
  category: ItemCategory;
  source: ItemSource;
  development_stage: string | null;
  due_date: string | null;
  due_time: string | null;
  estimated_minutes: number | null;
  position: number;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemWithSubtasks extends Item {
  subtasks: Item[];
  tags?: Tag[];
  participants?: DevelopmentParticipant[];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface ItemTag {
  item_id: string;
  tag_id: string;
}

export interface CreateItemPayload {
  title: string;
  description?: string;
  type?: ItemType;
  status?: ItemStatus;
  priority?: ItemPriority;
  category?: ItemCategory;
  source?: ItemSource;
  development_stage?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  estimated_minutes?: number | null;
  parent_id?: string | null;
  tags?: string[];
  participants?: DevelopmentParticipantInput[];
}

export interface UpdateItemPayload {
  title?: string;
  description?: string;
  type?: ItemType;
  status?: ItemStatus;
  priority?: ItemPriority;
  category?: ItemCategory;
  source?: ItemSource;
  development_stage?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  estimated_minutes?: number | null;
  position?: number;
  parent_id?: string | null;
  tags?: string[];
  participants?: DevelopmentParticipantInput[];
}

export interface Filters {
  search: string;
  categories: ItemCategory[];
  priorities: ItemPriority[];
  types: ItemType[];
  tags: string[];
  showArchived: boolean;
  advancedGroups: FilterGroup[];
  useAdvanced: boolean;
}

// User-editable task statuses (DB-backed). The 6 legacy ItemStatus keys are
// seeded as the initial rows; users can rename, reorder, recolor and add
// custom statuses. `kind` carries the well-known semantics that the app
// branches on regardless of the row's user-visible name.
export type ItemStatusKind = "open" | "done" | "archived";

export interface ItemStatusRow {
  id: string;
  name: string;
  color: string;
  position: number;
  kind: ItemStatusKind;
  created_at: string;
  updated_at: string;
}

export const STATUS_CONFIG: Record<ItemStatus, { label: string; color: string }> = {
  inbox: { label: "Входящие", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  todo: { label: "К выполнению", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  in_progress: { label: "В работе", color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
  review: { label: "На проверке", color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" },
  done: { label: "Готово", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" },
  archived: { label: "Архив", color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500" },
};

export const PRIORITY_CONFIG: Record<ItemPriority, { label: string; color: string; icon: string }> = {
  urgent: { label: "Срочно", color: "text-red-500", icon: "🔴" },
  high: { label: "Высокий", color: "text-orange-500", icon: "🟠" },
  medium: { label: "Средний", color: "text-yellow-500", icon: "🟡" },
  low: { label: "Низкий", color: "text-blue-500", icon: "🔵" },
  none: { label: "Без приоритета", color: "text-gray-400", icon: "⚪" },
};

export const SOURCE_CONFIG: Record<ItemSource, { label: string; icon: string }> = {
  system: { label: "Система", icon: "Monitor" },
  kaiten: { label: "Kaiten", icon: "ExternalLink" },
  claude: { label: "Claude", icon: "Sparkles" },
};

export const TYPE_CONFIG: Record<ItemType, { label: string; icon: string }> = {
  task: { label: "Задача", icon: "CheckSquare" },
  note: { label: "Заметка", icon: "StickyNote" },
  meeting: { label: "Встреча", icon: "Calendar" },
  plan: { label: "План", icon: "Map" },
  idea: { label: "Идея", icon: "Lightbulb" },
};

export interface SavedFilter {
  id: string;
  name: string;
  filters: Filters;
}

export const KANBAN_COLUMNS: ItemStatus[] = ["inbox", "todo", "in_progress", "review", "done"];

// --- Weekly Planning ---

export type WeeklyPlanStatus = "active" | "completed" | "archived";
export type EntryResultStatus = "pending" | "done" | "not_done" | "transferred";

export interface WeeklyPlan {
  id: string;
  week_start: string;
  week_end: string;
  title: string;
  status: WeeklyPlanStatus;
  created_at: string;
  updated_at: string;
}

export interface WeeklyPlanEntry {
  id: string;
  plan_id: string;
  item_id: string;
  position: number;
  result_status: EntryResultStatus;
  result_comment: string;
  created_at: string;
  updated_at: string;
}

export interface EntryComment {
  id: string;
  entry_id: string;
  text: string;
  created_at: string;
}

export interface WeeklyPlanEntryWithItem extends WeeklyPlanEntry {
  item: Item;
  comments: EntryComment[];
}

export interface WeeklyPlanFull extends WeeklyPlan {
  entries: WeeklyPlanEntryWithItem[];
}

export interface WeeklyPlanReport {
  plan: WeeklyPlan;
  done: WeeklyPlanEntryWithItem[];
  not_done: WeeklyPlanEntryWithItem[];
  transferred: WeeklyPlanEntryWithItem[];
  unplanned_done: Item[];
  total: number;
  done_count: number;
  completion_rate: number;
}

export const RESULT_STATUS_CONFIG: Record<EntryResultStatus, { label: string; icon: string; color: string }> = {
  pending: { label: "Ожидает", icon: "Clock", color: "text-gray-400" },
  done: { label: "Выполнено", icon: "CheckCircle2", color: "text-emerald-600" },
  not_done: { label: "Не выполнено", icon: "XCircle", color: "text-red-500" },
  transferred: { label: "Перенесено", icon: "ArrowRight", color: "text-amber-500" },
};

// --- Clients ---

export type ContactFieldType = "email" | "phone" | "telegram" | "note";

export const CONTACT_FIELD_CONFIG: Record<ContactFieldType, { label: string; icon: string; placeholder: string }> = {
  email: { label: "Email", icon: "Mail", placeholder: "email@example.com" },
  phone: { label: "Телефон", icon: "Phone", placeholder: "+7 (999) 123-45-67" },
  telegram: { label: "Telegram", icon: "Send", placeholder: "@username" },
  note: { label: "Заметка", icon: "StickyNote", placeholder: "Заметка о контакте..." },
};

export interface ClientStatus {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface ClientCompany {
  id: string;
  client_id: string;
  name: string;
}

export interface ClientContactField {
  id: string;
  contact_id: string;
  type: ContactFieldType;
  value: string;
}

export interface ClientContact {
  id: string;
  client_id: string;
  name: string;
  position: number;
  fields: ClientContactField[];
}

export interface ClientNote {
  id: string;
  client_id: string;
  text: string;
  created_at: string;
}

export interface ClientLink {
  id: string;
  client_id: string;
  url: string;
  title: string;
}

export interface CrmSystem {
  id: string;
  name: string;
  position: number;
}

export interface ClientParams {
  budget: string;
  operators_per_shift: string;
  operators_total: string;
  calls_per_month: string;
  crm_system: string;
}

export const CLIENT_PARAMS_CONFIG: { key: keyof ClientParams; label: string; placeholder: string; icon: string }[] = [
  { key: "budget", label: "Бюджет", placeholder: "напр. 500 000 руб.", icon: "Banknote" },
  { key: "operators_per_shift", label: "Операторов в смену", placeholder: "напр. 10", icon: "UserCheck" },
  { key: "operators_total", label: "Операторов в штате", placeholder: "напр. 30", icon: "Users" },
  { key: "calls_per_month", label: "Обращений в месяц", placeholder: "напр. 5000", icon: "PhoneCall" },
];

export interface Client extends ClientParams {
  id: string;
  name: string;
  status_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ClientFull extends Client {
  status: ClientStatus | null;
  companies: ClientCompany[];
  contacts: ClientContact[];
  notes: ClientNote[];
  links: ClientLink[];
  crm_systems: CrmSystem[];
}

export interface CreateClientPayload extends Partial<ClientParams> {
  name: string;
  status_id?: string | null;
  crm_system_ids?: string[];
  companies?: { name: string }[];
  contacts?: { name: string; fields?: { type: ContactFieldType; value: string }[] }[];
  notes?: { text: string }[];
  links?: { url: string; title: string }[];
}

export interface UpdateClientPayload extends Partial<ClientParams> {
  name?: string;
  status_id?: string | null;
  position?: number;
  crm_system_ids?: string[];
  companies?: { id?: string; name: string }[];
  contacts?: { id?: string; name: string; fields?: { id?: string; type: ContactFieldType; value: string }[] }[];
  notes?: { id?: string; text: string }[];
  links?: { id?: string; url: string; title: string }[];
}

export type ClientGroupByField = "none" | "status" | "budget" | "operators_per_shift" | "crm_system";
export type ClientGroupByConfig = [ClientGroupByField, ClientGroupByField];

export type AppSection = "tasks" | "clients" | "staging" | "settings";
export type ClientViewMode = "list" | "kanban";

// --- Relations ---

export type EntityType = "item" | "client";

export interface RelationType {
  id: string;
  name: string;
  color: string;
  icon: string;
  position: number;
  is_system: number; // 1 = system type (cannot be deleted)
}

export interface Relation {
  id: string;
  source_type: EntityType;
  source_id: string;
  target_type: EntityType;
  target_id: string;
  relation_type_id: string | null;
  created_at: string;
}

export interface RelationWithTarget extends Relation {
  target_title: string;
  relation_type: RelationType | null;
}

// --- Comments (universal) ---

export interface Comment {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  text: string;
  author_email: string;
  created_at: string;
  updated_at: string;
}

// --- Staging (approval queue) ---

export type StagingStatus = "pending" | "approved" | "rejected";
export type StagingEntityType = "item" | "client";

export interface StagingItem {
  id: string;
  entity_type: StagingEntityType;
  title: string;
  description: string;
  parsed_data: string; // JSON: полные поля для создания (type, status, priority, category, due_date, tags, subtasks, relations, client fields)
  staging_status: StagingStatus;
  batch_id: string; // группировка элементов одного /add вызова
  created_at: string;
  updated_at: string;
}

export interface StagingItemParsed extends Omit<StagingItem, "parsed_data"> {
  parsed_data: StagingParsedData;
}

export interface StagingParsedData {
  // Item fields
  type?: ItemType | null;
  status?: ItemStatus | null;
  priority?: ItemPriority | null;
  category?: ItemCategory | null;
  development_stage?: string | null;
  due_date?: string | null;
  tags?: string[];
  participants?: DevelopmentParticipantInput[];
  parent_id?: string | null;
  subtasks?: { title: string; description?: string }[];
  relations?: { target_type: EntityType; target_id?: string; target_title?: string; relation_type_id?: string | null; relation_type?: string }[];

  // Client fields
  budget?: string;
  operators_per_shift?: string;
  operators_total?: string;
  calls_per_month?: string;
  crm_system?: string;
  crm_system_ids?: string[];
  companies?: { name: string }[];
  contacts?: { name: string; fields?: { type: ContactFieldType; value: string }[] }[];
  notes?: { text: string }[];
  links?: { url: string; title: string }[];
  status_id?: string | null;

  // External sync metadata
  external_source?: "kaiten" | "claude";
  external_id?: string;
  external_title?: string;
  external_url?: string | null;
  external_status?: string | null;
  external_board_id?: number | null;
  external_board_name?: string | null;
  external_space_id?: number | null;
  external_space_name?: string | null;
  external_column_id?: number | null;
  external_column_name?: string | null;
  external_lane_id?: number | null;
  external_lane_name?: string | null;
  external_updated_at?: string | null;
  remote_payload?: Record<string, unknown>;
}

// --- Integrations / Kaiten sync ---

export type IntegrationProvider = "kaiten";
export type SyncEntityType = "item" | "client";
export type SyncDirection = "import" | "export" | "bidirectional";
export type ExternalSyncState = "active" | "pending" | "error" | "archived";

export interface IntegrationSettings {
  provider: IntegrationProvider;
  enabled: boolean;
  company_domain: string;
  api_base_url: string;
  has_token: boolean;
  token_masked: string | null;
  default_import_target: "staging";
  created_at: string;
  updated_at: string;
}

export interface IntegrationSettingsInput {
  enabled: boolean;
  company_domain: string;
  token?: string;
  clear_token?: boolean;
  default_import_target?: "staging";
}

export interface SyncProfile {
  id: string;
  provider: IntegrationProvider;
  name: string;
  entity_type: SyncEntityType;
  source_space_id: number | null;
  source_board_id: number | null;
  import_enabled: boolean;
  export_enabled: boolean;
  sync_interval_minutes: number;
  remote_wins_on_conflict: boolean;
  source_statuses: string[];
  source_columns: string[];
  source_lanes: string[];
  available_development_stages: KaitenStageOption[];
  available_participants: DevelopmentParticipantInput[];
  last_catalog_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncProfileInput {
  id?: string;
  name: string;
  entity_type?: SyncEntityType;
  source_space_id?: number | null;
  source_board_id?: number | null;
  import_enabled?: boolean;
  export_enabled?: boolean;
  sync_interval_minutes?: number;
  remote_wins_on_conflict?: boolean;
  source_statuses?: string[];
  source_columns?: string[];
  source_lanes?: string[];
  available_development_stages?: KaitenStageOption[];
  available_participants?: DevelopmentParticipantInput[];
  last_catalog_synced_at?: string | null;
}

export interface SyncFieldMapping {
  id: string;
  profile_id: string;
  local_entity_type: SyncEntityType;
  local_field: string;
  remote_field: string;
  direction: SyncDirection;
  transform_rule: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncFieldMappingInput {
  id?: string;
  profile_id: string;
  local_entity_type?: SyncEntityType;
  local_field: string;
  remote_field: string;
  direction?: SyncDirection;
  transform_rule?: string | null;
}

export interface ExternalEntityLink {
  id: string;
  provider: IntegrationProvider;
  profile_id: string | null;
  local_entity_type: SyncEntityType;
  local_entity_id: string;
  remote_entity_type: string;
  remote_entity_id: string;
  remote_space_id: number | null;
  remote_board_id: number | null;
  remote_column_id: number | null;
  remote_lane_id: number | null;
  last_remote_updated_at: string | null;
  last_local_synced_at: string | null;
  sync_state: ExternalSyncState;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface KaitenSpace {
  id: number;
  title: string;
}

export interface KaitenBoard {
  id: number;
  title: string;
  space_id: number | null;
}

export interface KaitenBoardOption extends KaitenBoard {
  statuses: string[];
  columns: { id: string; title: string }[];
  lanes: { id: string; title: string }[];
}

export interface KaitenStageOption {
  value: string;
  label: string;
  column_id: number | null;
  lane_id: number | null;
  column_title: string | null;
  lane_title: string | null;
}

export interface KaitenSyncCatalog {
  development_stages: KaitenStageOption[];
  participants: DevelopmentParticipantInput[];
  profiles: Array<{
    profile_id: string;
    profile_name: string;
    board_id: number | null;
    development_stages: KaitenStageOption[];
    participants: DevelopmentParticipantInput[];
    last_catalog_synced_at: string | null;
  }>;
}

export type SyncOutboxStatus = "pending" | "processing" | "error";

export interface SyncOutboxJob {
  id: string;
  provider: IntegrationProvider;
  profile_id: string | null;
  local_entity_type: SyncEntityType;
  local_entity_id: string;
  remote_entity_type: string;
  remote_entity_id: string;
  status: SyncOutboxStatus;
  attempts: number;
  requested_at: string;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface KaitenImportStats {
  found: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface KaitenImportResult extends KaitenImportStats {
  batch_id: string;
  profile_id: string;
  imported_ids: string[];
  errors_detail: string[];
}

export const KAITEN_DEFAULT_FIELD_MAPPINGS: Array<{
  local_field: "title" | "description" | "status" | "priority" | "due_date" | "tags";
  remote_field: string;
}> = [
  { local_field: "title", remote_field: "title" },
  { local_field: "description", remote_field: "description" },
  { local_field: "status", remote_field: "status" },
  { local_field: "priority", remote_field: "priority" },
  { local_field: "due_date", remote_field: "due_date" },
  { local_field: "tags", remote_field: "tags" },
];

// --- Time tracking ---

export type PomodoroMode = "25_5" | "50_10";
export type PomodoroPhase = "focus" | "break";
export type TimeEntrySource =
  | "manual"
  | "auto_stop"
  | "idle_discard"
  | "mutex_replace"
  | "manual_edit"
  | "pomodoro_complete";

export interface TimeEntry {
  id: string;
  user_email: string;
  item_id: string;
  started_at: string;            // ISO 8601 (TIMESTAMPTZ from Postgres)
  ended_at: string | null;
  last_heartbeat_at: string | null;
  last_active_at: string | null;
  reminder_sent_at: string | null;
  note: string;
  source: TimeEntrySource;
  pomodoro_mode: PomodoroMode | null;
  pomodoro_phase: PomodoroPhase | null;
  created_at: string;
  updated_at: string;
}

export interface ActiveTimerSnapshot {
  entry: TimeEntry | null;
  item_title: string | null;
  server_now: string;            // ISO timestamp from server, for clock-drift correction
}

export interface TimingSettings {
  user_email: string;
  idle_threshold_min: number;
  reminder_interval_min: number;
  hard_cap_hours: number;
  default_pomodoro: PomodoroMode | null;
  updated_at: string;
}

export interface TimingSettingsInput {
  idle_threshold_min?: number;
  reminder_interval_min?: number;
  hard_cap_hours?: number;
  default_pomodoro?: PomodoroMode | null;
}

export const TIMING_SETTINGS_DEFAULTS: Omit<TimingSettings, "user_email" | "updated_at"> = {
  idle_threshold_min: 5,
  reminder_interval_min: 60,
  hard_cap_hours: 4,
  default_pomodoro: null,
};

export interface ItemTimeTotals {
  item_id: string;
  self_seconds: number;          // own sessions
  total_seconds: number;         // self + all descendants
}

export interface CreateTimeEntryPayload {
  item_id: string;
  started_at: string;
  ended_at: string;
  note?: string;
}

export interface UpdateTimeEntryPayload {
  started_at?: string;
  ended_at?: string;
  note?: string;
}
