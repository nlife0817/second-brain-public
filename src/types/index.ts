export type ItemType = "task" | "note" | "meeting" | "plan" | "idea";
export type ItemStatus = "inbox" | "todo" | "in_progress" | "review" | "done" | "archived";
export type ItemPriority = "urgent" | "high" | "medium" | "low" | "none";
export type ItemCategory = "projects" | "development" | "clients" | "research" | "other";
export type ViewMode = "kanban" | "list" | "weekly";
export type SubtaskDisplayMode = "inline" | "accordion" | "detached";
export type ListGroupByField = "none" | "status" | "priority" | "category" | "type";
export type ListGroupByConfig = [ListGroupByField, ListGroupByField];

export type FilterOperator = "is" | "is_not" | "contains" | "not_contains" | "before" | "after" | "is_empty" | "is_not_empty";
export type FilterField = "status" | "priority" | "category" | "type" | "title" | "description" | "due_date" | "has_parent";
export type FilterLogic = "and" | "or";

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
  due_date: string | null;
  position: number;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemWithSubtasks extends Item {
  subtasks: Item[];
  tags?: Tag[];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
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
  due_date?: string | null;
  parent_id?: string | null;
  tags?: string[];
}

export interface UpdateItemPayload {
  title?: string;
  description?: string;
  type?: ItemType;
  status?: ItemStatus;
  priority?: ItemPriority;
  category?: ItemCategory;
  due_date?: string | null;
  position?: number;
  parent_id?: string | null;
  tags?: string[];
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

export const CATEGORY_CONFIG: Record<ItemCategory, { label: string; icon: string }> = {
  projects: { label: "Проекты", icon: "FolderKanban" },
  development: { label: "Разработка", icon: "Code2" },
  clients: { label: "Клиенты", icon: "Users" },
  research: { label: "Исследования", icon: "FlaskConical" },
  other: { label: "Другое", icon: "MoreHorizontal" },
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
  { key: "crm_system", label: "CRM-система", placeholder: "напр. Bitrix24", icon: "Database" },
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
}

export interface CreateClientPayload extends Partial<ClientParams> {
  name: string;
  status_id?: string | null;
  companies?: { name: string }[];
  contacts?: { name: string; fields?: { type: ContactFieldType; value: string }[] }[];
  notes?: { text: string }[];
  links?: { url: string; title: string }[];
}

export interface UpdateClientPayload extends Partial<ClientParams> {
  name?: string;
  status_id?: string | null;
  position?: number;
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
  type?: ItemType;
  status?: ItemStatus;
  priority?: ItemPriority;
  category?: ItemCategory;
  due_date?: string | null;
  tags?: string[];
  parent_id?: string | null;
  subtasks?: { title: string; description?: string }[];
  relations?: { target_type: EntityType; target_title: string; relation_type?: string }[];

  // Client fields
  budget?: string;
  operators_per_shift?: string;
  operators_total?: string;
  calls_per_month?: string;
  crm_system?: string;
  companies?: { name: string }[];
  contacts?: { name: string; fields?: { type: ContactFieldType; value: string }[] }[];
  notes?: { text: string }[];
  links?: { url: string; title: string }[];
  status_id?: string | null;
}
