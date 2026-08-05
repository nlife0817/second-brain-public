// Модель представлений сводного списка «Все задачи»: колонки, сортировка,
// группировка и фильтры. Всё считается на клиенте по уже загруженному набору —
// так фильтр применяется мгновенно, а счётчики групп остаются честными
// (при серверной пагинации они врали бы).
//
// Форма фильтров — `FilterGroup[]`: группы соединяются через И, условия
// внутри группы через И/ИЛИ.

import type { CustomField, StatusCategory, TaskListItem, TaskPriority, TaskRow } from "./types";

// --- Фильтры ------------------------------------------------------------------

export type FilterOperator =
  | "is"
  | "is_not"
  | "contains"
  | "not_contains"
  | "before"
  | "after"
  | "is_today"
  | "is_this_week"
  | "is_overdue"
  | "is_empty"
  | "is_not_empty";

/** Поле фильтра. Кастомные поля адресуются как `field:<uuid>`. */
export type FilterField =
  | "status"
  | "priority"
  | "project"
  | "assignee"
  | "tag"
  | "title"
  | "start_date"
  | "due_date"
  | "completed"
  | "has_parent"
  | "archive"
  | "done"
  | `field:${string}`;

export type FilterLogic = "and" | "or";

export interface FilterCondition {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  /** Для «is/is_not» — id сущности, для дат — ISO-день, для текста — подстрока. */
  value: string;
}

export interface FilterGroup {
  id: string;
  logic: FilterLogic;
  conditions: FilterCondition[];
}

/** Значение-заглушка «ничего не выбрано» — общее для проекта и исполнителя. */
export const NONE_VALUE = "__none__";
/** Подстановка «текущий пользователь» в условии по исполнителю. */
export const ME_VALUE = "__me__";

/**
 * Значения полей-переключателей («Архив», «Готово»). Умолчание — `hide`, даже
 * когда условия нет вовсе.
 */
export const SHOW_VALUE = "show";
export const HIDE_VALUE = "hide";

/**
 * Поля-переключатели: не условие на строку, а режим показа целой группы задач.
 * Каждому соответствует вид статуса, задачи которого по умолчанию не видны.
 */
export const VISIBILITY_FIELDS = [
  { field: "archive", label: "Архив", statusCategory: "archived" },
  { field: "done", label: "Готово", statusCategory: "done" },
] as const satisfies ReadonlyArray<{ field: FilterField; label: string; statusCategory: StatusCategory }>;

/** Быстрая проверка «это переключатель, а не условие на строку». */
const VISIBILITY_FIELD_SET: ReadonlySet<FilterField> = new Set(VISIBILITY_FIELDS.map((f) => f.field));

export interface FieldMeta {
  field: FilterField;
  label: string;
  /** Какие операторы имеют смысл: определяет и вид редактора значения. */
  kind: "select" | "text" | "date" | "boolean" | "visibility";
}

export const BASE_FILTER_FIELDS: FieldMeta[] = [
  { field: "status", label: "Статус", kind: "select" },
  { field: "priority", label: "Приоритет", kind: "select" },
  { field: "project", label: "Проект", kind: "select" },
  { field: "assignee", label: "Исполнитель", kind: "select" },
  { field: "tag", label: "Тег", kind: "select" },
  { field: "title", label: "Название", kind: "text" },
  { field: "start_date", label: "Начало", kind: "date" },
  { field: "due_date", label: "Дедлайн", kind: "date" },
  { field: "completed", label: "Завершена", kind: "boolean" },
  { field: "has_parent", label: "Подзадача", kind: "boolean" },
  ...VISIBILITY_FIELDS.map((f) => ({ field: f.field, label: f.label, kind: "visibility" as const })),
];

export const OPERATORS_BY_KIND: Record<FieldMeta["kind"], FilterOperator[]> = {
  select: ["is", "is_not", "is_empty", "is_not_empty"],
  text: ["contains", "not_contains", "is_empty", "is_not_empty"],
  date: ["is", "before", "after", "is_today", "is_this_week", "is_overdue", "is_empty", "is_not_empty"],
  boolean: ["is"],
  visibility: ["is"],
};

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: "равно",
  is_not: "не равно",
  contains: "содержит",
  not_contains: "не содержит",
  before: "раньше",
  after: "позже",
  is_today: "сегодня",
  is_this_week: "на этой неделе",
  is_overdue: "просрочено",
  is_empty: "пусто",
  is_not_empty: "не пусто",
};

/** Операторы, которым не нужно значение — редактор значения для них скрыт. */
export const VALUELESS_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  "is_today",
  "is_this_week",
  "is_overdue",
  "is_empty",
  "is_not_empty",
]);

export function fieldMetaFor(field: FilterField, customFields: CustomField[]): FieldMeta {
  const base = BASE_FILTER_FIELDS.find((f) => f.field === field);
  if (base) return base;
  const id = field.startsWith("field:") ? field.slice("field:".length) : null;
  const custom = id ? customFields.find((f) => f.id === id) : undefined;
  if (!custom) return { field, label: "Поле", kind: "text" };
  const kind: FieldMeta["kind"] =
    custom.type === "select" || custom.type === "multi_select" || custom.type === "user"
      ? "select"
      : custom.type === "date"
        ? "date"
        : custom.type === "checkbox"
          ? "boolean"
          : "text";
  return { field, label: custom.name, kind };
}

export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Понедельник–воскресенье текущей недели в ISO-днях. */
export function weekBounds(now: Date = new Date()): { from: string; to: string } {
  const day = (now.getDay() + 6) % 7; // 0 = понедельник
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { from: todayIso(monday), to: todayIso(sunday) };
}

export interface MatchContext {
  today: string;
  week: { from: string; to: string };
  meId: string | null;
}

export function makeMatchContext(meId: string | null, now: Date = new Date()): MatchContext {
  return { today: todayIso(now), week: weekBounds(now), meId };
}

/** Значения задачи по полю фильтра — в виде списка строк для сравнения. */
function valuesOf(task: TaskRow, field: FilterField): string[] {
  switch (field) {
    case "status":
      return task.status_id ? [task.status_id] : [];
    case "priority":
      return task.priority === "none" ? [] : [task.priority];
    case "project":
      return task.placements.map((p) => p.project_id);
    case "assignee":
      return task.assignees.map((a) => a.id);
    case "tag":
      return task.tags.map((t) => t.id);
    case "title":
      return [task.title];
    case "start_date":
      return task.start_date ? [task.start_date] : [];
    case "due_date":
      return task.due_date ? [task.due_date] : [];
    case "completed":
      return [task.completed_at ? "yes" : "no"];
    case "has_parent":
      return [task.parent_task_id ? "yes" : "no"];
    case "archive":
    case "done":
      // Режим показа, а не свойство задачи, — см. hiddenStatusIds.
      return [];
    default: {
      const id = field.slice("field:".length);
      const raw = task.field_values[id];
      if (raw == null || raw === "") return [];
      if (Array.isArray(raw)) return raw.map((v) => String(v));
      if (typeof raw === "boolean") return [raw ? "yes" : "no"];
      return [String(raw)];
    }
  }
}

function matchesCondition(task: TaskRow, cond: FilterCondition, ctx: MatchContext): boolean {
  const values = valuesOf(task, cond.field);
  // «Исполнитель = я» и «проект не выбран» разворачиваются здесь, а не в UI.
  const target = cond.value === ME_VALUE ? (ctx.meId ?? "") : cond.value;

  switch (cond.operator) {
    case "is_empty":
      return values.length === 0;
    case "is_not_empty":
      return values.length > 0;
    case "is":
      if (target === NONE_VALUE) return values.length === 0;
      return values.includes(target);
    case "is_not":
      if (target === NONE_VALUE) return values.length > 0;
      return !values.includes(target);
    case "contains":
      return values.some((v) => v.toLowerCase().includes(target.toLowerCase()));
    case "not_contains":
      return !values.some((v) => v.toLowerCase().includes(target.toLowerCase()));
    case "before":
      return values.some((v) => v < target);
    case "after":
      return values.some((v) => v > target);
    case "is_today":
      return values.some((v) => v === ctx.today);
    case "is_this_week":
      return values.some((v) => v >= ctx.week.from && v <= ctx.week.to);
    case "is_overdue":
      return !task.completed_at && values.some((v) => v < ctx.today);
    default:
      return true;
  }
}

/**
 * Включён ли показ группы, скрытой по умолчанию. «Архив» и «Готово» — это
 * прошлое, а не работа: без явного «Показать» они всплывают в каждой
 * группировке и в счётчиках групп, ради чего фильтры и заводились.
 *
 * Логика группы (И/ИЛИ) здесь роли не играет: это переключатель видимости, а не
 * условие на строку, и «спрятано, пока не попросили» — единственное поведение,
 * которое читается однозначно.
 */
function showsField(groups: FilterGroup[], field: FilterField): boolean {
  return groups.some((g) =>
    g.conditions.some((c) => c.field === field && c.operator === "is" && c.value === SHOW_VALUE),
  );
}

/**
 * Просит ли фильтр показать завершённые. Отдельно от `hiddenStatusIds` потому,
 * что от этого зависит ещё и запрос: сервер завершённых по умолчанию не отдаёт,
 * и без `&done=1` фильтр показал бы пустоту вместо задач. Архива это не
 * касается — `completed_at` архивным не проставляют, они приходят всегда.
 */
export function showsDone(groups: FilterGroup[]): boolean {
  return showsField(groups, "done");
}

/**
 * Статусы, задачи которых список не показывает: все архивные и завершающие,
 * кроме тех, чью группу включили фильтром. Пустое множество — прятать нечего.
 */
export function hiddenStatusIds(
  groups: FilterGroup[],
  statuses: ReadonlyArray<{ id: string; category: StatusCategory }>,
): Set<string> {
  const hidden = new Set<StatusCategory>(
    VISIBILITY_FIELDS.filter((f) => !showsField(groups, f.field)).map((f) => f.statusCategory),
  );
  return new Set(statuses.filter((s) => hidden.has(s.category)).map((s) => s.id));
}

/**
 * Задачи, которые экран показывает до фильтра: без архивных и завершённых,
 * пока их не попросили показать. Отсев отдельным шагом, а не условием фильтра —
 * это умолчание экрана, и в знаменателе счётчика «N из M» ему делать нечего.
 */
export function visiblePool<T extends { status_id: string | null }>(
  tasks: T[],
  groups: FilterGroup[],
  statuses: ReadonlyArray<{ id: string; category: StatusCategory }>,
): T[] {
  const hidden = hiddenStatusIds(groups, statuses);
  if (hidden.size === 0) return tasks;
  return tasks.filter((t) => !(t.status_id && hidden.has(t.status_id)));
}

/**
 * Условия фильтра плюс поиск по названию. Общая для таблицы и доски: разошлись
 * бы — один и тот же фильтр показывал бы в двух видах проекта разные задачи.
 */
export function filterTasks(
  tasks: TaskRow[],
  groups: FilterGroup[],
  search: string,
  ctx: MatchContext,
): TaskRow[] {
  const needle = search.trim().toLowerCase();
  if (needle === "" && groups.length === 0) return tasks;
  return tasks.filter((t) => {
    if (needle && !t.title.toLowerCase().includes(needle)) return false;
    return matchesGroups(t, groups, ctx);
  });
}

/** Группы объединяются через И, условия внутри группы — по её `logic`. */
export function matchesGroups(task: TaskRow, groups: FilterGroup[], ctx: MatchContext): boolean {
  for (const group of groups) {
    // «Архив» и «Готово» — режимы показа, их разбирает hiddenStatusIds: как
    // предикат строки они бы вырезали из списка вообще всё.
    const active = group.conditions.filter((c) => !VISIBILITY_FIELD_SET.has(c.field));
    if (active.length === 0) continue;
    const results = active.map((c) => matchesCondition(task, c, ctx));
    const ok = group.logic === "and" ? results.every(Boolean) : results.some(Boolean);
    if (!ok) return false;
  }
  return true;
}

// --- Сортировка ----------------------------------------------------------------

export type SortColumn =
  | "priority"
  | "title"
  | "status"
  | "project"
  | "start_date"
  | "due_date"
  | "estimated_minutes"
  | "subtasks"
  | "created_at"
  | "updated_at";

export type SortDirection = "asc" | "desc";

export interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

/** Срочное — выше. Отдельная шкала, потому что алфавит здесь бессмысленен. */
export const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export interface SortContext {
  statusPosition: Map<string, number>;
  projectPosition: Map<string, number>;
  projectName: Map<string, string>;
}

function compareNullableString(a: string | null, b: string | null): number {
  // Пустое значение всегда в конце — независимо от направления сортировки:
  // «без дедлайна» внизу читается естественнее, чем вперемешку.
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}

// Принимает `TaskListItem`, а не `TaskRow`: тех же правил порядка ждёт секция
// подзадач в карточке, а кастомных полей сортировка не смотрит вовсе.
export function compareTasks(
  a: TaskListItem,
  b: TaskListItem,
  sort: SortState,
  ctx: SortContext,
): number {
  const dir = sort.direction === "asc" ? 1 : -1;
  let base = 0;
  switch (sort.column) {
    case "priority":
      base = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      break;
    case "title":
      base = a.title.localeCompare(b.title, "ru");
      break;
    case "status": {
      const pa = a.status_id ? (ctx.statusPosition.get(a.status_id) ?? 9999) : 10000;
      const pb = b.status_id ? (ctx.statusPosition.get(b.status_id) ?? 9999) : 10000;
      base = pa - pb;
      break;
    }
    case "project": {
      const na = a.placements[0] ? (ctx.projectName.get(a.placements[0].project_id) ?? "") : "";
      const nb = b.placements[0] ? (ctx.projectName.get(b.placements[0].project_id) ?? "") : "";
      base = compareNullableString(na || null, nb || null);
      break;
    }
    case "start_date":
      base = compareNullableString(a.start_date, b.start_date);
      break;
    case "due_date":
      base = compareNullableString(a.due_date, b.due_date);
      break;
    case "estimated_minutes": {
      const ea = a.estimated_minutes;
      const eb = b.estimated_minutes;
      if (ea == null && eb == null) base = 0;
      else if (ea == null) base = 1;
      else if (eb == null) base = -1;
      else base = ea - eb;
      break;
    }
    case "subtasks":
      base = a.subtask_count - b.subtask_count;
      break;
    case "created_at":
      base = a.created_at.localeCompare(b.created_at);
      break;
    case "updated_at":
      base = a.updated_at.localeCompare(b.updated_at);
      break;
  }
  // Пустые значения не переворачиваем: compareNullableString уже прижал их вниз.
  if (base === 0) return a.created_at.localeCompare(b.created_at);
  const nullPinned =
    (sort.column === "start_date" && (!a.start_date || !b.start_date)) ||
    (sort.column === "due_date" && (!a.due_date || !b.due_date)) ||
    (sort.column === "estimated_minutes" && (a.estimated_minutes == null || b.estimated_minutes == null));
  return nullPinned ? base : base * dir;
}

// --- Группировка ---------------------------------------------------------------

export type GroupByField =
  | "none"
  | "status"
  | "priority"
  | "project"
  | "assignee"
  | "tag"
  | "due"
  | "estimate";

export type GroupByConfig = [GroupByField, GroupByField];

/**
 * Ручной порядок групп — по типу группировки, а не по уровню: одно и то же поле
 * должно выстраиваться одинаково и первым уровнем, и вторым, иначе настройка
 * читается как случайная. Перечислены не обязательно все значения поля: то, чего
 * в списке нет (новый статус, новый проект), встаёт после расставленных.
 */
export type GroupOrderMap = Partial<Record<GroupByField, string[]>>;

export const GROUP_BY_LABELS: Record<GroupByField, string> = {
  none: "Без группировки",
  status: "Статус",
  priority: "Приоритет",
  project: "Проект",
  assignee: "Исполнитель",
  tag: "Тег",
  due: "Срок",
  estimate: "Оценка",
};

export const DUE_BUCKETS = [
  { key: "overdue", label: "Просрочено" },
  { key: "today", label: "Сегодня" },
  { key: "week", label: "На этой неделе" },
  { key: "later", label: "Позже" },
  { key: NONE_VALUE, label: "Без срока" },
] as const;

export const ESTIMATE_BUCKETS = [
  { key: "lt30", label: "До 30 мин", max: 30 },
  { key: "lt2h", label: "30 мин – 2 ч", max: 120 },
  { key: "lt8h", label: "2 – 8 ч", max: 480 },
  { key: "gt8h", label: "Больше 8 ч", max: Number.POSITIVE_INFINITY },
] as const;

export function estimateBucket(minutes: number | null): string {
  if (minutes == null) return NONE_VALUE;
  return ESTIMATE_BUCKETS.find((b) => minutes <= b.max)?.key ?? NONE_VALUE;
}

export function dueBucket(due: string | null, ctx: MatchContext): string {
  if (!due) return NONE_VALUE;
  if (due < ctx.today) return "overdue";
  if (due === ctx.today) return "today";
  if (due <= ctx.week.to) return "week";
  return "later";
}

// --- Подзадачи в списке ------------------------------------------------------------

/**
 * Как список показывает подзадачи — три режима:
 *  - flat: подзадача — обычная строка наравне с родителем;
 *  - nested: подзадача с отступом сразу под своим родителем;
 *  - hidden: подзадачи скрыты, если их родитель и так виден.
 */
export type SubtaskMode = "flat" | "nested" | "hidden";

export const SUBTASK_MODE_LABELS: Record<SubtaskMode, string> = {
  flat: "Отдельными строками",
  nested: "Вложенными под родителя",
  hidden: "Скрыть подзадачи",
};

export interface ArrangedRow {
  task: TaskRow;
  depth: number;
  /**
   * Есть ли у задачи подзадачи в текущем срезе. От этого зависит, рисовать ли
   * шеврон: у листа сворачивать нечего, а кнопка, которая ничего не меняет,
   * читается как сломанная.
   */
  hasChildren: boolean;
  /** Поддерево свёрнуто — строки подзадач в выдачу не попали. */
  collapsed: boolean;
}

/** Циклов в данных быть не должно, но защита дешевле, чем зависший рендер. */
const MAX_DEPTH = 8;

/** Общая пустая ссылка: аргумент по умолчанию не должен ломать memo. */
const NO_COLLAPSED: ReadonlySet<string> = new Set();

/**
 * Дерево задач по всему набору — считается ДО группировки. Это ключевой момент:
 * родство определяется по всему списку, а не внутри корзины группы. Иначе
 * подзадача, у которой статус (проект, исполнитель) отличается от родительского,
 * попадала бы в чужую корзину, не находила там родителя и рисовалась отдельной
 * строкой — при включённом режиме «вложенными под родителя».
 */
export interface TaskForest {
  /** Дети по id родителя, в порядке, который задала сортировка. */
  childrenOf: Map<string, TaskRow[]>;
  /**
   * Строки верхнего уровня: задачи без родителя и «осиротевшие» подзадачи, чей
   * родитель не попал в набор (отфильтрован или недоступен). Сюда же уходят
   * узлы, до которых не дошёл обход, — иначе взаимная ссылка в данных унесла бы
   * задачу из списка совсем.
   */
  roots: TaskRow[];
}

/**
 * `sortChildren` — порядок внутри ветки. Без него дети идут так же, как их
 * отсортировал список, и это верно для «сортировать всё по дедлайну». Но ручной
 * порядок подзадач задан человеком осознанно, и карточка показывает именно его,
 * поэтому таблица умеет упорядочивать ветки тем же правилом — иначе одна и та
 * же ветка выглядела бы в карточке и в списке по-разному. Корней это не
 * касается: их порядок задаёт сортировка списка.
 */
export function buildForest(
  tasks: TaskRow[],
  sortChildren?: (a: TaskRow, b: TaskRow) => number,
): TaskForest {
  const present = new Set(tasks.map((t) => t.id));
  const hasVisibleParent = (t: TaskRow) => !!t.parent_task_id && present.has(t.parent_task_id);

  const childrenOf = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    if (!hasVisibleParent(t)) continue;
    const arr = childrenOf.get(t.parent_task_id!);
    if (arr) arr.push(t);
    else childrenOf.set(t.parent_task_id!, [t]);
  }
  if (sortChildren) for (const arr of childrenOf.values()) arr.sort(sortChildren);

  const roots = tasks.filter((t) => !hasVisibleParent(t));

  const reachable = new Set<string>();
  const walk = (task: TaskRow, depth: number) => {
    if (reachable.has(task.id) || depth > MAX_DEPTH) return;
    reachable.add(task.id);
    for (const child of childrenOf.get(task.id) ?? []) walk(child, depth + 1);
  };
  for (const task of roots) walk(task, 0);
  for (const task of tasks) {
    if (reachable.has(task.id)) continue;
    roots.push(task);
    walk(task, 0);
  }

  return { childrenOf, roots };
}

/**
 * Поддеревья перечисленных корней — плоским списком строк с глубиной.
 *
 * `collapsedTasks` — id задач, чьи поддеревья свёрнуты. Ключ именно id задачи, а
 * не путь в дереве: задача остаётся той же при смене группировки и сортировки, и
 * свёрнутая ветка не разворачивается сама от того, что список перестроили.
 */
export function expandRoots(
  roots: TaskRow[],
  forest: TaskForest,
  collapsedTasks: ReadonlySet<string> = NO_COLLAPSED,
): ArrangedRow[] {
  const out: ArrangedRow[] = [];
  const emitted = new Set<string>();
  const emit = (task: TaskRow, depth: number) => {
    if (emitted.has(task.id) || depth > MAX_DEPTH) return;
    emitted.add(task.id);
    const children = forest.childrenOf.get(task.id) ?? [];
    // Свёрнутость без детей не считается: id остаётся в наборе (задачу могли
    // отфильтровать), но строка обязана выглядеть обычным листом.
    const collapsed = children.length > 0 && collapsedTasks.has(task.id);
    out.push({ task, depth, hasChildren: children.length > 0, collapsed });
    if (collapsed) return;
    for (const child of children) emit(child, depth + 1);
  };
  for (const task of roots) emit(task, 0);
  return out;
}

export interface GroupLabel {
  text: string;
  color?: string;
}

export interface GroupNode {
  key: string;
  path: string;
  label: GroupLabel;
  tasks: TaskRow[];
  children: GroupNode[];
}

/** Подписи и порядок ключей берутся снаружи: справочники живут в сторе экрана. */
export interface GroupNaming {
  labelForGroup: (field: GroupByField, key: string) => GroupLabel;
  /** Порядок ключей группы: у справочников он свой (позиция статуса и т.п.). */
  groupOrder: (field: GroupByField, keys: string[]) => string[];
}

/**
 * Порядок ключей групп: сначала расставленные руками — в том порядке, в каком их
 * расставили, — затем остальные по правилу справочника, «пусто» последним.
 *
 * Три решения, которые здесь легко потерять обратной правкой:
 *  - неперечисленные ключи идут ПОСЛЕ расставленных, а не вперемешку с ними:
 *    новый статус (проект, участник) не должен всплывать в начало списка только
 *    потому, что о нём ещё никто не знает;
 *  - «пусто» остаётся в конце даже если его затащили в ручной порядок: это не
 *    значение поля, а его отсутствие, и место у него всегда одно;
 *  - равные ранги разводит подпись, а не порядок ключей в наборе: иначе список
 *    групп менялся бы от того, в каком порядке задачи приехали с сервера.
 */
export function orderGroupKeys(
  keys: string[],
  {
    manual,
    rank,
    label,
  }: {
    /** Ручной порядок для этого поля; может не совпадать с набором ключей. */
    manual?: readonly string[];
    /** Ранг по справочнику: позиция статуса, вес приоритета, номер корзины. */
    rank: (key: string) => number;
    label: (key: string) => string;
  },
): string[] {
  // «Полка» и ранг внутри неё: 0 — расставленные руками, 1 — остальные, 2 — пусто.
  const slotOf = (key: string): [number, number] => {
    if (key === NONE_VALUE) return [2, 0];
    const at = manual ? manual.indexOf(key) : -1;
    return at >= 0 ? [0, at] : [1, rank(key)];
  };
  return [...keys].sort((a, b) => {
    const [sa, ra] = slotOf(a);
    const [sb, rb] = slotOf(b);
    if (sa !== sb) return sa - sb;
    if (ra !== rb) return ra - rb;
    return label(a).localeCompare(label(b), "ru");
  });
}

/**
 * Двухуровневые группы. Живёт здесь, а не в таблице: гант раскладывает строки
 * той же группировкой, и вторая копия означала бы, что одна настройка даёт в
 * таблице и на ганте разные группы с разными счётчиками.
 */
export function buildGroups(
  tasks: TaskRow[],
  fields: GroupByConfig,
  matchCtx: MatchContext,
  { labelForGroup, groupOrder }: GroupNaming,
  forest: TaskForest | null,
): GroupNode[] {
  const [first, second] = fields;
  // В режимах «вложенными» и «скрыть» по корзинам раскладываются ТОЛЬКО корни:
  // подзадача едет под родителем, в его группу, а не отдельной строкой в свою.
  // Раскладка всех подряд и была причиной, по которой вложенность разваливалась
  // при любой активной группировке — а по умолчанию она включена.
  const source = forest ? forest.roots : tasks;
  if (first === "none") {
    return [{ key: "__all__", path: "__all__", label: { text: "" }, tasks: source, children: [] }];
  }

  const buckets = new Map<string, TaskRow[]>();
  for (const task of source) {
    // Задача с несколькими проектами/исполнителями/тегами попадает в каждую
    // группу — иначе список молча теряет часть её принадлежностей.
    for (const key of groupKeys(task, first, matchCtx)) {
      const arr = buckets.get(key);
      if (arr) arr.push(task);
      else buckets.set(key, [task]);
    }
  }

  return groupOrder(first, [...buckets.keys()]).map((key) => {
    const rows = buckets.get(key) ?? [];
    const path = `${first}:${key}`;
    if (second === "none") {
      return { key, path, label: labelForGroup(first, key), tasks: rows, children: [] };
    }
    const sub = new Map<string, TaskRow[]>();
    for (const task of rows) {
      for (const subKey of groupKeys(task, second, matchCtx)) {
        const arr = sub.get(subKey);
        if (arr) arr.push(task);
        else sub.set(subKey, [task]);
      }
    }
    return {
      key,
      path,
      label: labelForGroup(first, key),
      tasks: rows,
      children: groupOrder(second, [...sub.keys()]).map((subKey) => ({
        key: subKey,
        path: `${path}/${second}:${subKey}`,
        label: labelForGroup(second, subKey),
        tasks: sub.get(subKey) ?? [],
        children: [],
      })),
    };
  });
}

/**
 * Строки одной группы. `groupRoots` — то, что реально разложено по этой корзине:
 * в режимах `nested`/`hidden` туда попадают только корни, поэтому подзадача едет
 * под родителем и в его группу.
 */
export function arrangeGroupRows(
  groupRoots: TaskRow[],
  forest: TaskForest | null,
  mode: SubtaskMode,
  collapsedTasks: ReadonlySet<string> = NO_COLLAPSED,
): ArrangedRow[] {
  if (mode === "nested" && forest) return expandRoots(groupRoots, forest, collapsedTasks);
  // Сворачивать нечего: в «отдельными строками» подзадача и так не под
  // родителем, в «скрыть» её нет вовсе. Шеврона на этих строках быть не должно.
  return groupRoots.map((task) => ({ task, depth: 0, hasChildren: false, collapsed: false }));
}

/**
 * Раскладка плоского (не сгруппированного) списка с учётом режима подзадач.
 * Порядок внутри уровня сохраняется тем, что задала сортировка.
 */
export function arrangeRows(
  tasks: TaskRow[],
  mode: SubtaskMode,
  collapsedTasks: ReadonlySet<string> = NO_COLLAPSED,
): ArrangedRow[] {
  if (mode === "flat") return tasks.map((task) => ({ task, depth: 0, hasChildren: false, collapsed: false }));
  const forest = buildForest(tasks);
  return arrangeGroupRows(forest.roots, forest, mode, collapsedTasks);
}

/**
 * Ключи группы для задачи. Возвращается список: задача с несколькими проектами
 * (multi-homing), исполнителями или тегами попадает в каждую группу — иначе
 * «Все задачи» врали бы, показывая её только в первой.
 */
export function groupKeys(task: TaskRow, field: GroupByField, ctx: MatchContext): string[] {
  switch (field) {
    case "status":
      return [task.status_id ?? NONE_VALUE];
    case "priority":
      return [task.priority];
    case "project":
      return task.placements.length ? task.placements.map((p) => p.project_id) : [NONE_VALUE];
    case "assignee":
      return task.assignees.length ? task.assignees.map((a) => a.id) : [NONE_VALUE];
    case "tag":
      return task.tags.length ? task.tags.map((t) => t.id) : [NONE_VALUE];
    case "due":
      return [dueBucket(task.due_date, ctx)];
    case "estimate":
      return [estimateBucket(task.estimated_minutes)];
    default:
      return [NONE_VALUE];
  }
}
