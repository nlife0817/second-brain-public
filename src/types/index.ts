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
