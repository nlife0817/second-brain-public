"use client";

// Настройки таблицы задач: колонки, сортировка, группировка, фильтры и
// именованные представления. Персистится в localStorage: набор колонок это
// рабочая привычка, терять её при перезагрузке нельзя.
//
// Стор не один: у сводного списка «Все задачи» и у каждого проекта он свой.
// Колонки и фильтры проекта — это другой рабочий срез, чем «всё сразу», и общий
// стор заставлял бы перенастраивать экран после каждого перехода. Отсюда
// фабрика + контекст вместо модульного синглтона.

import { createContext, createElement, useContext, type ReactNode } from "react";
import { create, createStore, useStore } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { FilterGroup, GroupByConfig, SortState, SubtaskMode } from "./views";

export interface ColumnDef {
  id: string;
  label: string;
  /** Короткая подпись в шапке, если полная не влезает. */
  headerLabel?: string;
  width: number;
  sortable: boolean;
  /** Колонка редактируется прямо в таблице. */
  editable: boolean;
}

export const BASE_COLUMNS: ColumnDef[] = [
  { id: "priority", label: "Приоритет", headerLabel: "P", width: 44, sortable: true, editable: true },
  { id: "title", label: "Название", width: 380, sortable: true, editable: true },
  { id: "status", label: "Статус", width: 132, sortable: true, editable: true },
  { id: "project", label: "Проект", width: 150, sortable: true, editable: false },
  { id: "assignees", label: "Исполнители", width: 116, sortable: false, editable: true },
  { id: "tags", label: "Теги", width: 150, sortable: false, editable: true },
  { id: "due_date", label: "Дедлайн", width: 116, sortable: true, editable: true },
  { id: "estimated_minutes", label: "Оценка", width: 88, sortable: true, editable: true },
  { id: "subtasks", label: "Подзадачи", headerLabel: "Подз.", width: 76, sortable: true, editable: false },
  { id: "comments", label: "Комментарии", headerLabel: "Комм.", width: 68, sortable: false, editable: false },
  { id: "created_at", label: "Создана", width: 104, sortable: true, editable: false },
  { id: "updated_at", label: "Обновлена", width: 104, sortable: true, editable: false },
];

export const DEFAULT_COLUMNS = [
  "priority",
  "title",
  "status",
  "project",
  "assignees",
  "tags",
  "due_date",
  "estimated_minutes",
  "subtasks",
];

export const COLUMN_MIN_WIDTH = 44;
export const COLUMN_MAX_WIDTH = 640;

// --- Область настроек ---------------------------------------------------------

/** Чьи это настройки: сводного списка или конкретного проекта. */
export type ViewScope = "all" | `project:${string}`;

export function projectScope(projectId: string): ViewScope {
  return `project:${projectId}`;
}

/**
 * Ключ в localStorage. У сводного списка он прежний: иначе выкатка стёрла бы
 * сохранённые представления и порядок колонок у всех, кто их настроил.
 */
function storageKey(scope: ViewScope): string {
  return scope === "all" ? "sb.v2.tasksView" : `sb.v2.view.${scope}`;
}

/** Как экран проекта показывает задачи. */
export type ProjectViewMode = "table" | "board";

/**
 * Снимок настроек, который сохраняется как именованное представление.
 *
 * Поиска здесь намеренно нет: строку ищут разово, «где та задача», и держать
 * её в представлении значит подставлять при каждом его выборе запрос, набранный
 * когда-то давно. Поиск живёт рядом, в `ViewState`.
 */
export interface ViewSnapshot {
  columns: string[];
  widths: Record<string, number>;
  sort: SortState;
  groupBy: GroupByConfig;
  groups: FilterGroup[];
  /** Завершённые в выборке. Переключатель остался только у экрана проекта. */
  showDone: boolean;
  subtaskMode: SubtaskMode;
}

export interface SavedView extends ViewSnapshot {
  id: string;
  name: string;
}

export interface ViewState extends ViewSnapshot {
  /** Поиск по списку — состояние сессии, а не часть представления. */
  search: string;
  savedViews: SavedView[];
  activeViewId: string | null;
  /** Свёрнутые группы — по ключу «уровень1/уровень2». */
  collapsed: string[];
  /** Таблица или доска — только для экрана проекта. */
  mode: ProjectViewMode;

  setMode: (mode: ProjectViewMode) => void;
  setColumns: (columns: string[]) => void;
  setWidth: (columnId: string, width: number) => void;
  toggleSort: (column: SortState["column"]) => void;
  setGroupBy: (config: GroupByConfig) => void;
  setGroups: (groups: FilterGroup[]) => void;
  setSearch: (search: string) => void;
  setShowDone: (show: boolean) => void;
  setSubtaskMode: (mode: SubtaskMode) => void;
  toggleCollapsed: (key: string) => void;

  saveView: (name: string) => void;
  applyView: (id: string) => void;
  duplicateView: (id: string) => void;
  deleteView: (id: string) => void;
  resetView: () => void;
}

const DEFAULT_SNAPSHOT: ViewSnapshot = {
  columns: DEFAULT_COLUMNS,
  widths: {},
  sort: { column: "due_date", direction: "asc" },
  groupBy: ["status", "none"],
  groups: [],
  showDone: false,
  subtaskMode: "nested",
};

/** В проекте колонка «Проект» повторяет заголовок экрана — её там нет. */
const PROJECT_DEFAULT_COLUMNS = DEFAULT_COLUMNS.filter((c) => c !== "project");

function defaultSnapshot(scope: ViewScope): ViewSnapshot {
  if (scope === "all") return DEFAULT_SNAPSHOT;
  return { ...DEFAULT_SNAPSHOT, columns: PROJECT_DEFAULT_COLUMNS };
}

function snapshotOf(state: ViewSnapshot): ViewSnapshot {
  return {
    columns: state.columns,
    widths: state.widths,
    sort: state.sort,
    groupBy: state.groupBy,
    groups: state.groups,
    showDone: state.showDone,
    subtaskMode: state.subtaskMode,
  };
}

/**
 * Правка настроек. Пока выбрано именованное представление, изменение уходит
 * прямо в него: представление — это рабочий срез, за которым возвращаются, а не
 * снимок на момент создания. Прежнее поведение отвязывало от представления при
 * любой правке (снял фильтр — и ты уже нигде), а сохранить изменение можно было
 * только отдельной кнопкой «обновить».
 *
 * Отсюда следствие: оригинал правится сразу. Чтобы отвести вариант, не задев
 * его, есть `duplicateView`, а выйти из представления вовсе — `resetView`.
 */
function edit(state: ViewState, patch: Partial<ViewSnapshot>): Partial<ViewState> {
  if (!state.activeViewId) return patch;
  return {
    ...patch,
    savedViews: state.savedViews.map((v) => (v.id === state.activeViewId ? { ...v, ...patch } : v)),
  };
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `v${Date.now()}${Math.round(Math.random() * 1e6)}`;
}

function createViewStore(scope: ViewScope) {
  const defaults = defaultSnapshot(scope);
  return createStore<ViewState>()(
    persist(
      (set, get) => ({
        ...defaults,
        search: "",
        savedViews: [],
        activeViewId: null,
        collapsed: [],
        mode: "table",

        setMode: (mode) => set({ mode }),
        setColumns: (columns) => set((s) => edit(s, { columns })),
        setWidth: (columnId, width) =>
          set((s) =>
            edit(s, {
              widths: {
                ...s.widths,
                [columnId]: Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTH, Math.round(width))),
              },
            }),
          ),
        toggleSort: (column) =>
          set((s) =>
            edit(s, {
              sort:
                s.sort.column === column
                  ? { column, direction: s.sort.direction === "asc" ? "desc" : "asc" }
                  : { column, direction: "asc" },
            }),
          ),
        setGroupBy: (groupBy) => set((s) => edit(s, { groupBy })),
        setGroups: (groups) => set((s) => edit(s, { groups })),
        setSearch: (search) => set({ search }),
        setShowDone: (showDone) => set((s) => edit(s, { showDone })),
        setSubtaskMode: (subtaskMode) => set((s) => edit(s, { subtaskMode })),
        toggleCollapsed: (key) =>
          set((s) => ({
            collapsed: s.collapsed.includes(key) ? s.collapsed.filter((k) => k !== key) : [...s.collapsed, key],
          })),

        saveView: (name) => {
          const view: SavedView = { id: newId(), name, ...snapshotOf(get()) };
          set((s) => ({ savedViews: [...s.savedViews, view], activeViewId: view.id }));
        },
        applyView: (id) => {
          const view = get().savedViews.find((v) => v.id === id);
          if (!view) return;
          set({ ...snapshotOf(view), activeViewId: id });
        },
        duplicateView: (id) => {
          const source = get().savedViews.find((v) => v.id === id);
          if (!source) return;
          const copy: SavedView = { ...source, id: newId(), name: `${source.name} — копия` };
          // Копия сразу становится активной: дублируют затем, чтобы править её.
          set((s) => ({ savedViews: [...s.savedViews, copy], activeViewId: copy.id, ...snapshotOf(copy) }));
        },
        deleteView: (id) =>
          set((s) => ({
            savedViews: s.savedViews.filter((v) => v.id !== id),
            activeViewId: s.activeViewId === id ? null : s.activeViewId,
          })),
        // Единственный способ выйти из представления, не выбрав другое. Поиск
        // снимаем заодно: список, оставшийся отфильтрованным после «сбросить»,
        // читается как поломка.
        resetView: () => set({ ...defaults, search: "", activeViewId: null }),
      }),
      {
        name: storageKey(scope),
        storage: createJSONStorage(() => localStorage),
        // collapsed не персистим: свёрнутые группы — состояние сессии, а не
        // настройка. Иначе после смены группировки половина списка «пропадает».
        partialize: (s) => ({
          ...snapshotOf(s),
          search: s.search,
          savedViews: s.savedViews,
          activeViewId: s.activeViewId,
          mode: s.mode,
        }),
        version: 1,
      },
    ),
  );
}

export type ViewStoreApi = ReturnType<typeof createViewStore>;

const stores = new Map<ViewScope, ViewStoreApi>();

/**
 * Экземпляр стора на область. Кэш живёт только в браузере: на сервере модульная
 * карта общая для всех одновременных запросов и росла бы по числу проектов, а
 * localStorage там всё равно нет — стор отдаёт умолчания, и свежий экземпляр
 * ничем не хуже сохранённого.
 */
function getViewStore(scope: ViewScope): ViewStoreApi {
  if (typeof window === "undefined") return createViewStore(scope);
  const existing = stores.get(scope);
  if (existing) return existing;
  const created = createViewStore(scope);
  stores.set(scope, created);
  return created;
}

const ViewStoreContext = createContext<ViewStoreApi | null>(null);

export function ViewStoreProvider({ scope, children }: { scope: ViewScope; children: ReactNode }) {
  // Без useState/useRef намеренно: кэш по области уже даёт стабильную ссылку, а
  // переход между проектами меняет область — состояние компонента здесь только
  // мешало бы отдать стор нового проекта.
  return createElement(ViewStoreContext.Provider, { value: getViewStore(scope) }, children);
}

export function useViewStore<T>(selector: (state: ViewState) => T): T {
  const store = useContext(ViewStoreContext);
  if (!store) throw new Error("useViewStore вне <ViewStoreProvider>");
  return useStore(store, selector);
}

// --- Как открывается карточка задачи ------------------------------------------------

/** Боковая панель справа или модальное окно по центру. */
export type TaskOpenMode = "sheet" | "modal";

export const TASK_OPEN_MODE_LABELS: Record<TaskOpenMode, string> = {
  sheet: "Через боковую панель",
  modal: "Модальное окно",
};

interface TaskOpenState {
  mode: TaskOpenMode;
  setMode: (mode: TaskOpenMode) => void;
}

/**
 * Стор один на приложение, а не по областям: способ открытия карточки — привычка
 * пользователя, а не часть рабочего среза. Иначе переход в проект молча менял бы
 * поведение, к которому человек привык на сводном списке.
 */
export const useTaskOpenStore = create<TaskOpenState>()(
  persist(
    (set) => ({
      mode: "sheet",
      setMode: (mode) => set({ mode }),
    }),
    { name: "sb.v2.taskOpenMode", storage: createJSONStorage(() => localStorage), version: 1 },
  ),
);

// --- Карточка доски ---------------------------------------------------------------

/** Поля, которые карточка задачи может показывать. Порядок = порядок отрисовки. */
export const CARD_FIELDS = [
  { id: "priority", label: "Приоритет" },
  { id: "project", label: "Проект" },
  { id: "tags", label: "Теги" },
  { id: "due_date", label: "Дедлайн" },
  { id: "estimated_minutes", label: "Оценка" },
  { id: "subtasks", label: "Подзадачи" },
  { id: "comments", label: "Комментарии" },
  { id: "assignees", label: "Исполнители" },
] as const;

export type CardFieldId = (typeof CARD_FIELDS)[number]["id"];

/** Значение по умолчанию — общая константа, иначе memo карточек ломается. */
export const DEFAULT_CARD_FIELDS: CardFieldId[] = [
  "priority",
  "tags",
  "due_date",
  "subtasks",
  "comments",
  "assignees",
];

interface CardState {
  cardFields: CardFieldId[];
  setCardFields: (fields: CardFieldId[]) => void;
  toggleCardField: (field: CardFieldId) => void;
}

export const useCardStore = create<CardState>()(
  persist(
    (set, get) => ({
      cardFields: DEFAULT_CARD_FIELDS,
      setCardFields: (cardFields) => set({ cardFields }),
      toggleCardField: (field) => {
        const current = get().cardFields;
        set({
          // Порядок фиксирован CARD_FIELDS: карточка должна выглядеть
          // одинаково независимо от того, в каком порядке галки ставили.
          cardFields: CARD_FIELDS.map((f) => f.id).filter((id) =>
            id === field ? !current.includes(id) : current.includes(id),
          ),
        });
      },
    }),
    { name: "sb.v2.cardFields", storage: createJSONStorage(() => localStorage), version: 1 },
  ),
);
