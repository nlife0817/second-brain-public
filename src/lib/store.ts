"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  Item,
  ItemWithSubtasks,
  Tag,
  Filters,
  ViewMode,
  ItemCategory,
  CreateItemPayload,
  UpdateItemPayload,
  ItemStatus,
  SubtaskDisplayMode,
  FilterGroup,
  FilterCondition,
  SavedFilter,
  WeeklyPlan,
  WeeklyPlanFull,
  WeeklyPlanReport,
  EntryResultStatus,
  ListGroupByConfig,
} from "@/types";

interface BrainStore {
  items: ItemWithSubtasks[];
  tags: Tag[];
  filters: Filters;
  viewMode: ViewMode;
  activeCategory: ItemCategory | "all";
  selectedItemId: string | null;
  isDetailOpen: boolean;
  isCreateOpen: boolean;
  createDefaults: Partial<CreateItemPayload>;
  loading: boolean;
  subtaskDisplayMode: SubtaskDisplayMode;
  editingItemId: string | null;
  editingField: string | null;
  cardVisibleFields: string[];
  listColumnOrder: string[];
  savedFilters: SavedFilter[];
  activeFilterId: string | null;
  detailMode: "modal" | "panel";
  listGroupBy: ListGroupByConfig;

  fetchItems: () => Promise<void>;
  fetchTags: () => Promise<void>;
  createItem: (payload: CreateItemPayload) => Promise<ItemWithSubtasks>;
  updateItem: (id: string, payload: UpdateItemPayload) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  reorderItems: (items: { id: string; position: number; status?: string }[]) => Promise<void>;
  createTag: (name: string, color?: string) => Promise<Tag>;
  detachSubtask: (subtaskId: string) => Promise<void>;

  setViewMode: (mode: ViewMode) => void;
  setActiveCategory: (cat: ItemCategory | "all") => void;
  setFilters: (filters: Partial<Filters>) => void;
  resetFilters: () => void;
  setAdvancedFilters: (groups: FilterGroup[]) => void;
  toggleAdvancedFilters: (on?: boolean) => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  openCreate: (defaults?: Partial<CreateItemPayload>) => void;
  closeCreate: () => void;
  setSubtaskDisplayMode: (mode: SubtaskDisplayMode) => void;
  setEditingItem: (id: string | null, field?: string | null) => void;
  setCardVisibleFields: (fields: string[]) => void;
  setListColumnOrder: (order: string[]) => void;
  saveFilter: (name: string) => void;
  loadFilter: (id: string) => void;
  updateFilter: (id: string) => void;
  deleteFilter: (id: string) => void;
  resetActiveFilter: () => void;
  setDetailMode: (mode: "modal" | "panel") => void;
  setListGroupBy: (config: ListGroupByConfig) => void;

  // Weekly plans
  weeklyPlans: WeeklyPlan[];
  currentPlan: WeeklyPlanFull | null;
  currentPlanId: string | null;
  currentPlanReport: WeeklyPlanReport | null;

  fetchWeeklyPlans: () => Promise<void>;
  fetchCurrentPlan: (id: string) => Promise<void>;
  createWeeklyPlan: (weekStart: string, weekEnd: string, title?: string, transferFromPlanId?: string, transferEntryIds?: string[]) => Promise<WeeklyPlan>;
  updateWeeklyPlan: (id: string, updates: Partial<WeeklyPlan>) => Promise<void>;
  deleteWeeklyPlan: (id: string) => Promise<void>;
  addItemsToPlan: (planId: string, itemIds: string[]) => Promise<void>;
  removeItemFromPlan: (planId: string, itemId: string) => Promise<void>;
  updatePlanEntry: (planId: string, entryId: string, updates: { result_status?: EntryResultStatus; result_comment?: string }) => Promise<void>;
  completeWeeklyPlan: (id: string) => Promise<void>;
  addEntryComment: (planId: string, entryId: string, text: string) => Promise<void>;
  fetchPlanReport: (planId: string) => Promise<void>;
  fetchUnplannedDone: (planId: string) => Promise<void>;
  unplannedDoneItems: Item[];
}

const defaultFilters: Filters = {
  search: "",
  categories: [],
  priorities: [],
  types: [],
  tags: [],
  showArchived: false,
  advancedGroups: [],
  useAdvanced: false,
};

export const useBrainStore = create<BrainStore>()(
  persist(
  (set, get) => ({
  items: [],
  tags: [],
  filters: { ...defaultFilters },
  viewMode: "kanban",
  activeCategory: "all",
  selectedItemId: null,
  isDetailOpen: false,
  isCreateOpen: false,
  createDefaults: {},
  loading: false,
  subtaskDisplayMode: "inline" as SubtaskDisplayMode,
  editingItemId: null,
  editingField: null,
  cardVisibleFields: ["priority", "category", "due_date", "subtasks", "type"],
  listColumnOrder: ["priority", "title", "status", "category", "type", "due_date", "subtasks"],
  savedFilters: [],
  activeFilterId: null,
  detailMode: "modal" as "modal" | "panel",
  listGroupBy: ["none", "none"] as ListGroupByConfig,

  // Weekly plans
  weeklyPlans: [],
  currentPlan: null,
  currentPlanId: null,
  currentPlanReport: null,
  unplannedDoneItems: [],

  fetchItems: async () => {
    set({ loading: true });
    const mode = get().subtaskDisplayMode;
    const params = mode === "detached" ? "?children=true" : "";
    const res = await fetch(`/api/items${params}`);
    if (!res.ok) { set({ loading: false }); return; }
    const items = await res.json();
    set({ items, loading: false });
  },

  fetchTags: async () => {
    const res = await fetch("/api/tags");
    if (!res.ok) return;
    const tags = await res.json();
    set({ tags });
  },

  createItem: async (payload) => {
    const res = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed to create item");
    const item = await res.json();
    await get().fetchItems();
    return item;
  },

  updateItem: async (id, payload) => {
    const res = await fetch(`/api/items/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed to update item");
    await get().fetchItems();
  },

  deleteItem: async (id) => {
    const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      isDetailOpen: s.selectedItemId === id ? false : s.isDetailOpen,
      selectedItemId: s.selectedItemId === id ? null : s.selectedItemId,
    }));
  },

  reorderItems: async (updates) => {
    // Optimistic update: apply new positions/statuses immediately
    const posMap = new Map(updates.map((u: { id: string; position: number; status?: string }) => [u.id, u]));
    set((s) => ({
      items: s.items.map((item) => {
        const upd = posMap.get(item.id);
        if (upd) {
          return {
            ...item,
            position: upd.position,
            ...(upd.status ? { status: upd.status as ItemStatus } : {}),
          };
        }
        return item;
      }),
    }));

    const res = await fetch("/api/items", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: updates }),
    });
    // Always re-fetch to sync with server (corrects on error too)
    await get().fetchItems();
  },

  createTag: async (name, color) => {
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    if (!res.ok) throw new Error("Failed to create tag");
    const tag = await res.json();
    await get().fetchTags();
    return tag;
  },

  detachSubtask: async (subtaskId) => {
    const res = await fetch(`/api/items/${subtaskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_id: null }),
    });
    if (!res.ok) return;
    await get().fetchItems();
  },

  setViewMode: (viewMode) => set({ viewMode }),
  setActiveCategory: (activeCategory) => set({ activeCategory }),
  setFilters: (partial) => set((s) => ({ filters: { ...s.filters, ...partial } })),
  resetFilters: () => set({ filters: { ...defaultFilters } }),
  setAdvancedFilters: (groups) => set((s) => ({ filters: { ...s.filters, advancedGroups: groups } })),
  toggleAdvancedFilters: (on) => set((s) => ({ filters: { ...s.filters, useAdvanced: on ?? !s.filters.useAdvanced } })),
  openDetail: (id) => set({ selectedItemId: id, isDetailOpen: true }),
  closeDetail: () => set({ isDetailOpen: false, selectedItemId: null }),
  openCreate: (defaults) => set({ isCreateOpen: true, createDefaults: defaults ?? {} }),
  closeCreate: () => set({ isCreateOpen: false, createDefaults: {} }),
  setSubtaskDisplayMode: (subtaskDisplayMode) => {
    set({ subtaskDisplayMode });
    get().fetchItems();
  },
  setEditingItem: (editingItemId, field = null) => set({ editingItemId, editingField: field }),
  setCardVisibleFields: (cardVisibleFields) => set({ cardVisibleFields }),
  setListColumnOrder: (listColumnOrder) => set({ listColumnOrder }),
  saveFilter: (name) => {
    const { filters, savedFilters } = get();
    const id = crypto.randomUUID();
    const newSaved: SavedFilter = {
      id,
      name,
      filters: { ...filters, search: "" },
    };
    set({ savedFilters: [...savedFilters, newSaved], activeFilterId: id });
  },
  loadFilter: (id) => {
    const saved = get().savedFilters.find((f) => f.id === id);
    if (saved) {
      set({
        filters: { ...saved.filters, search: get().filters.search },
        activeFilterId: id,
      });
    }
  },
  updateFilter: (id) => {
    const { filters, savedFilters } = get();
    set({
      savedFilters: savedFilters.map((f) =>
        f.id === id ? { ...f, filters: { ...filters, search: "" } } : f
      ),
    });
  },
  deleteFilter: (id) => {
    const { savedFilters, activeFilterId } = get();
    set({
      savedFilters: savedFilters.filter((f) => f.id !== id),
      activeFilterId: activeFilterId === id ? null : activeFilterId,
    });
  },
  resetActiveFilter: () => set({ activeFilterId: null }),
  setDetailMode: (detailMode) => set({ detailMode }),
  setListGroupBy: (listGroupBy) => {
    // If level 1 is "none", level 2 must also be "none"
    if (listGroupBy[0] === "none") {
      set({ listGroupBy: ["none", "none"] });
    } else {
      // If level 2 equals level 1, reset level 2
      const l2 = listGroupBy[1] === listGroupBy[0] ? "none" : listGroupBy[1];
      set({ listGroupBy: [listGroupBy[0], l2] as ListGroupByConfig });
    }
  },

  // Weekly plans
  fetchWeeklyPlans: async () => {
    const res = await fetch("/api/weekly-plans");
    if (!res.ok) return;
    const weeklyPlans = await res.json();
    set({ weeklyPlans });
  },

  fetchCurrentPlan: async (id) => {
    const res = await fetch(`/api/weekly-plans/${id}`);
    if (!res.ok) { set({ currentPlan: null, currentPlanId: null }); return; }
    const currentPlan = await res.json();
    set({ currentPlan, currentPlanId: id });
  },

  createWeeklyPlan: async (weekStart, weekEnd, title, transferFromPlanId, transferEntryIds) => {
    const res = await fetch("/api/weekly-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week_start: weekStart, week_end: weekEnd, title: title ?? "", transferFromPlanId, transferEntryIds }),
    });
    if (!res.ok) throw new Error("Failed to create weekly plan");
    const plan = await res.json();
    await get().fetchWeeklyPlans();
    await get().fetchCurrentPlan(plan.id);
    return plan;
  },

  updateWeeklyPlan: async (id, updates) => {
    const res = await fetch(`/api/weekly-plans/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) return;
    await get().fetchWeeklyPlans();
    if (get().currentPlanId === id) await get().fetchCurrentPlan(id);
  },

  deleteWeeklyPlan: async (id) => {
    const res = await fetch(`/api/weekly-plans/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    if (get().currentPlanId === id) set({ currentPlan: null, currentPlanId: null });
    await get().fetchWeeklyPlans();
  },

  addItemsToPlan: async (planId, itemIds) => {
    const res = await fetch(`/api/weekly-plans/${planId}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds }),
    });
    if (!res.ok) return;
    if (get().currentPlanId === planId) await get().fetchCurrentPlan(planId);
  },

  removeItemFromPlan: async (planId, itemId) => {
    const res = await fetch(`/api/weekly-plans/${planId}/entries`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    if (!res.ok) return;
    if (get().currentPlanId === planId) await get().fetchCurrentPlan(planId);
  },

  updatePlanEntry: async (planId, entryId, updates) => {
    const res = await fetch(`/api/weekly-plans/${planId}/entries/${entryId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) return;
    if (get().currentPlanId === planId) await get().fetchCurrentPlan(planId);
  },

  completeWeeklyPlan: async (id) => {
    const res = await fetch(`/api/weekly-plans/${id}/complete`, { method: "POST" });
    if (!res.ok) return;
    await get().fetchWeeklyPlans();
    await get().fetchCurrentPlan(id);
  },

  addEntryComment: async (planId, entryId, text) => {
    const res = await fetch(`/api/weekly-plans/${planId}/entries/${entryId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return;
    if (get().currentPlanId === planId) await get().fetchCurrentPlan(planId);
  },

  fetchPlanReport: async (planId) => {
    const res = await fetch(`/api/weekly-plans/${planId}/report`);
    if (!res.ok) { set({ currentPlanReport: null }); return; }
    const currentPlanReport = await res.json();
    set({ currentPlanReport });
  },

  fetchUnplannedDone: async (planId) => {
    const res = await fetch(`/api/weekly-plans/${planId}/report`);
    if (!res.ok) { set({ unplannedDoneItems: [] }); return; }
    const report = await res.json();
    set({ unplannedDoneItems: report.unplanned_done || [] });
  },
}),
  {
    name: "second-brain-settings",
    storage: createJSONStorage(() => localStorage),
    partialize: (state) => ({
      viewMode: state.viewMode,
      activeCategory: state.activeCategory,
      subtaskDisplayMode: state.subtaskDisplayMode,
      cardVisibleFields: state.cardVisibleFields,
      listColumnOrder: state.listColumnOrder,
      savedFilters: state.savedFilters,
      activeFilterId: state.activeFilterId,
      detailMode: state.detailMode,
      listGroupBy: state.listGroupBy,
      currentPlanId: state.currentPlanId,
      filters: {
        categories: state.filters.categories,
        priorities: state.filters.priorities,
        types: state.filters.types,
        showArchived: state.filters.showArchived,
        advancedGroups: state.filters.advancedGroups,
        useAdvanced: state.filters.useAdvanced,
        search: "",
        tags: [],
      },
    }),
  }
));

function matchCondition(item: ItemWithSubtasks, cond: FilterCondition): boolean {
  const fieldValue = (() => {
    switch (cond.field) {
      case "status": return item.status;
      case "priority": return item.priority;
      case "category": return item.category;
      case "type": return item.type;
      case "title": return item.title;
      case "description": return item.description;
      case "due_date": return item.due_date ?? "";
      case "has_parent": return item.parent_id ? "yes" : "no";
      default: return "";
    }
  })();

  switch (cond.operator) {
    case "is": return fieldValue === cond.value;
    case "is_not": return fieldValue !== cond.value;
    case "contains": return fieldValue.toLowerCase().includes(cond.value.toLowerCase());
    case "not_contains": return !fieldValue.toLowerCase().includes(cond.value.toLowerCase());
    case "before": return !!fieldValue && fieldValue < cond.value;
    case "after": return !!fieldValue && fieldValue > cond.value;
    case "is_empty": return !fieldValue || fieldValue === "";
    case "is_not_empty": return !!fieldValue && fieldValue !== "";
    default: return true;
  }
}

export function useFilteredItems() {
  const items = useBrainStore((s) => s.items);
  const filters = useBrainStore((s) => s.filters);
  const activeCategory = useBrainStore((s) => s.activeCategory);

  return useMemo(() => items.filter((item) => {
    if (!filters.showArchived && item.status === "archived") return false;
    if (activeCategory !== "all" && item.category !== activeCategory) return false;

    // Basic filters
    if (!filters.useAdvanced) {
      if (filters.categories.length && !filters.categories.includes(item.category)) return false;
      if (filters.priorities.length && !filters.priorities.includes(item.priority)) return false;
      if (filters.types.length && !filters.types.includes(item.type)) return false;
    }

    // Search always applies
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!item.title.toLowerCase().includes(q) && !item.description.toLowerCase().includes(q)) return false;
    }

    // Advanced filter groups
    if (filters.useAdvanced && filters.advancedGroups.length > 0) {
      // Groups are connected with OR logic between them
      const groupResults = filters.advancedGroups.map((group) => {
        if (group.conditions.length === 0) return true;
        if (group.logic === "and") {
          return group.conditions.every((c) => matchCondition(item, c));
        } else {
          return group.conditions.some((c) => matchCondition(item, c));
        }
      });
      if (!groupResults.some(Boolean)) return false;
    }

    return true;
  }), [items, filters, activeCategory]);
}

export function useSelectedItem(): ItemWithSubtasks | null {
  const items = useBrainStore((s) => s.items);
  const selectedId = useBrainStore((s) => s.selectedItemId);
  if (!selectedId) return null;
  // Search top-level
  const topLevel = items.find((i) => i.id === selectedId);
  if (topLevel) return topLevel;
  // Search within subtasks
  for (const item of items) {
    const sub = item.subtasks?.find((s) => s.id === selectedId);
    if (sub) return { ...sub, subtasks: [], tags: [] } as ItemWithSubtasks;
  }
  return null;
}

export function useItemsByStatus(status: ItemStatus): ItemWithSubtasks[] {
  const items = useFilteredItems();
  return items.filter((i) => i.status === status).sort((a, b) => a.position - b.position);
}
