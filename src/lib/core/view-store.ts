"use client";

// Настройки сводного экрана «Все задачи»: колонки, сортировка, группировка,
// фильтры и именованные представления. Персистится в localStorage — как
// listColumnOrder/savedFilters в v1: набор колонок это рабочая привычка,
// терять её при перезагрузке нельзя.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { FilterGroup, GroupByConfig, SortState } from "./views";

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

/** Снимок настроек, который сохраняется как именованное представление. */
export interface ViewSnapshot {
  columns: string[];
  widths: Record<string, number>;
  sort: SortState;
  groupBy: GroupByConfig;
  groups: FilterGroup[];
  search: string;
  showDone: boolean;
  showArchivedProjects: boolean;
}

export interface SavedView extends ViewSnapshot {
  id: string;
  name: string;
}

interface ViewState extends ViewSnapshot {
  savedViews: SavedView[];
  activeViewId: string | null;
  /** Свёрнутые группы — по ключу «уровень1/уровень2». */
  collapsed: string[];

  setColumns: (columns: string[]) => void;
  setWidth: (columnId: string, width: number) => void;
  toggleSort: (column: SortState["column"]) => void;
  setGroupBy: (config: GroupByConfig) => void;
  setGroups: (groups: FilterGroup[]) => void;
  setSearch: (search: string) => void;
  setShowDone: (show: boolean) => void;
  setShowArchivedProjects: (show: boolean) => void;
  toggleCollapsed: (key: string) => void;

  saveView: (name: string) => void;
  applyView: (id: string) => void;
  updateActiveView: () => void;
  deleteView: (id: string) => void;
  resetView: () => void;
}

const DEFAULT_SNAPSHOT: ViewSnapshot = {
  columns: DEFAULT_COLUMNS,
  widths: {},
  sort: { column: "due_date", direction: "asc" },
  groupBy: ["status", "none"],
  groups: [],
  search: "",
  showDone: false,
  showArchivedProjects: false,
};

function snapshotOf(state: ViewSnapshot): ViewSnapshot {
  return {
    columns: state.columns,
    widths: state.widths,
    sort: state.sort,
    groupBy: state.groupBy,
    groups: state.groups,
    search: state.search,
    showDone: state.showDone,
    showArchivedProjects: state.showArchivedProjects,
  };
}

/**
 * Ручная правка настроек отвязывает от представления: иначе кнопка «обновить»
 * молча перезаписала бы сохранённое чужими изменениями.
 */
function edit(patch: Partial<ViewSnapshot>): Partial<ViewState> {
  return { ...patch, activeViewId: null };
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `v${Date.now()}${Math.round(Math.random() * 1e6)}`;
}

export const useViewStore = create<ViewState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SNAPSHOT,
      savedViews: [],
      activeViewId: null,
      collapsed: [],

      setColumns: (columns) => set(edit({ columns })),
      setWidth: (columnId, width) =>
        set((s) => ({
          ...edit({
            widths: {
              ...s.widths,
              [columnId]: Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTH, Math.round(width))),
            },
          }),
        })),
      toggleSort: (column) =>
        set((s) => ({
          ...edit({
            sort:
              s.sort.column === column
                ? { column, direction: s.sort.direction === "asc" ? "desc" : "asc" }
                : { column, direction: "asc" },
          }),
        })),
      setGroupBy: (groupBy) => set(edit({ groupBy })),
      setGroups: (groups) => set(edit({ groups })),
      setSearch: (search) => set({ search }),
      setShowDone: (showDone) => set(edit({ showDone })),
      setShowArchivedProjects: (showArchivedProjects) => set(edit({ showArchivedProjects })),
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
      updateActiveView: () => {
        const { activeViewId } = get();
        if (!activeViewId) return;
        const snapshot = snapshotOf(get());
        set((s) => ({
          savedViews: s.savedViews.map((v) => (v.id === activeViewId ? { ...v, ...snapshot } : v)),
        }));
      },
      deleteView: (id) =>
        set((s) => ({
          savedViews: s.savedViews.filter((v) => v.id !== id),
          activeViewId: s.activeViewId === id ? null : s.activeViewId,
        })),
      resetView: () => set({ ...DEFAULT_SNAPSHOT, activeViewId: null }),
    }),
    {
      name: "sb.v2.tasksView",
      storage: createJSONStorage(() => localStorage),
      // collapsed не персистим: свёрнутые группы — состояние сессии, а не
      // настройка. Иначе после смены группировки половина списка «пропадает».
      partialize: (s) => ({
        ...snapshotOf(s),
        savedViews: s.savedViews,
        activeViewId: s.activeViewId,
      }),
      version: 1,
    },
  ),
);
