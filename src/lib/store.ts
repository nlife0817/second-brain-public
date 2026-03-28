"use client";

import { create } from "zustand";
import {
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

export const useBrainStore = create<BrainStore>((set, get) => ({
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

  fetchItems: async () => {
    try {
      set({ loading: true });
      const mode = get().subtaskDisplayMode;
      const params = mode === "detached" ? "?children=true" : "";
      const res = await fetch(`/api/items${params}`);
      const items = await res.json();
      console.log("[store] fetchItems:", items.length, "items loaded");
      set({ items, loading: false });
    } catch (e) {
      console.error("[store] fetchItems error:", e);
      set({ loading: false });
    }
  },

  fetchTags: async () => {
    const res = await fetch("/api/tags");
    const tags = await res.json();
    set({ tags });
  },

  createItem: async (payload) => {
    const res = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const item = await res.json();
    await get().fetchItems();
    return item;
  },

  updateItem: async (id, payload) => {
    await fetch(`/api/items/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await get().fetchItems();
  },

  deleteItem: async (id) => {
    await fetch(`/api/items/${id}`, { method: "DELETE" });
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      isDetailOpen: s.selectedItemId === id ? false : s.isDetailOpen,
      selectedItemId: s.selectedItemId === id ? null : s.selectedItemId,
    }));
  },

  reorderItems: async (items) => {
    await fetch("/api/items", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    await get().fetchItems();
  },

  createTag: async (name, color) => {
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    const tag = await res.json();
    await get().fetchTags();
    return tag;
  },

  detachSubtask: async (subtaskId) => {
    await fetch(`/api/items/${subtaskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_id: null }),
    });
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
}));

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

  return items.filter((item) => {
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
  });
}

export function useSelectedItem(): ItemWithSubtasks | null {
  const items = useBrainStore((s) => s.items);
  const selectedId = useBrainStore((s) => s.selectedItemId);
  if (!selectedId) return null;
  return items.find((i) => i.id === selectedId) ?? null;
}

export function useItemsByStatus(status: ItemStatus): ItemWithSubtasks[] {
  const items = useFilteredItems();
  return items.filter((i) => i.status === status).sort((a, b) => a.position - b.position);
}
