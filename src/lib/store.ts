"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  Item,
  ItemWithSubtasks,
  Tag,
  Category,
  CrmSystem,
  DevelopmentParticipant,
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
  AppSection,
  ClientViewMode,
  ClientGroupByConfig,
  ClientFull,
  ClientStatus,
  CreateClientPayload,
  UpdateClientPayload,
  RelationType,
  RelationWithTarget,
  Comment,
  EntityType,
  StagingItem,
  StagingItemParsed,
  StagingParsedData,
} from "@/types";

interface BrainStore {
  items: ItemWithSubtasks[];
  tags: Tag[];
  categories: Category[];
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

  fetchInit: () => Promise<void>;
  fetchItems: () => Promise<void>;
  fetchTags: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  createCategory: (name: string, color?: string, icon?: string) => Promise<Category>;
  updateCategory: (id: string, updates: Partial<Category>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  createItem: (payload: CreateItemPayload) => Promise<ItemWithSubtasks>;
  updateItem: (id: string, payload: UpdateItemPayload) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  reorderItems: (items: { id: string; position: number; status?: string }[]) => Promise<void>;
  createTag: (name: string, color?: string) => Promise<Tag>;
  updateTag: (id: string, updates: Partial<Tag>) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
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

  // App section
  appSection: AppSection;
  setAppSection: (section: AppSection) => void;

  // Clients
  clients: ClientFull[];
  clientStatuses: ClientStatus[];
  selectedClientId: string | null;
  isClientDetailOpen: boolean;
  isCreateClientOpen: boolean;
  clientSearch: string;
  clientViewMode: ClientViewMode;
  clientStatusFilter: string | null;
  clientGroupBy: ClientGroupByConfig;

  setClientViewMode: (mode: ClientViewMode) => void;
  setClientStatusFilter: (statusId: string | null) => void;
  setClientGroupBy: (config: ClientGroupByConfig) => void;
  reorderClients: (updates: { id: string; position: number; status_id?: string }[]) => Promise<void>;

  fetchClients: () => Promise<void>;
  fetchClientStatuses: () => Promise<void>;
  createClient: (payload: CreateClientPayload) => Promise<ClientFull>;
  updateClient: (id: string, payload: UpdateClientPayload) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  createClientStatus: (name: string, color?: string) => Promise<ClientStatus>;
  updateClientStatus: (id: string, updates: Partial<ClientStatus>) => Promise<void>;
  deleteClientStatus: (id: string) => Promise<void>;

  // CRM systems
  crmSystems: CrmSystem[];
  fetchCrmSystems: () => Promise<void>;
  createCrmSystem: (name: string) => Promise<CrmSystem>;
  updateCrmSystem: (id: string, updates: Partial<CrmSystem>) => Promise<void>;
  deleteCrmSystem: (id: string) => Promise<void>;

  // Development stages
  developmentStages: { id: string; name: string; position: number }[];
  fetchDevelopmentStages: () => Promise<void>;
  createDevelopmentStage: (name: string) => Promise<void>;
  updateDevelopmentStage: (id: string, updates: Record<string, unknown>) => Promise<void>;
  deleteDevelopmentStage: (id: string) => Promise<void>;

  // Development participants (all, not per-item)
  allParticipants: DevelopmentParticipant[];
  fetchAllParticipants: () => Promise<void>;
  createParticipant: (name: string) => Promise<void>;
  updateParticipant: (id: string, updates: Record<string, unknown>) => Promise<void>;
  deleteParticipant: (id: string) => Promise<void>;

  openClientDetail: (id: string) => void;
  closeClientDetail: () => void;
  openCreateClient: () => void;
  closeCreateClient: () => void;
  setClientSearch: (search: string) => void;

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

  // Entity counts (relations + comments per item/client)
  itemRelationCounts: Record<string, number>;
  itemCommentCounts: Record<string, number>;
  clientRelationCounts: Record<string, number>;
  clientCommentCounts: Record<string, number>;
  itemRelationTitles: Record<string, string[]>;
  itemLinkedClients: Record<string, string[]>;
  fetchEntityCounts: (entityType: EntityType) => Promise<void>;

  // Relation types
  relationTypes: RelationType[];
  fetchRelationTypes: () => Promise<void>;
  createRelationType: (name: string, color?: string, icon?: string, is_system?: number) => Promise<RelationType>;
  updateRelationType: (id: string, updates: Partial<RelationType>) => Promise<void>;
  deleteRelationType: (id: string) => Promise<void>;

  // Staging
  stagingItems: StagingItemParsed[];
  fetchStagingItems: () => Promise<void>;
  approveStagingItem: (id: string) => Promise<void>;
  rejectStagingItem: (id: string) => Promise<void>;
  updateStagingItem: (id: string, updates: Partial<Pick<StagingItem, "title" | "description" | "entity_type"> & { parsed_data: StagingParsedData }>) => Promise<void>;
  deleteStagingItem: (id: string) => Promise<void>;

  // Relations (fetched per-entity, not global)
  fetchRelations: (entityType: EntityType, entityId: string) => Promise<RelationWithTarget[]>;
  createRelation: (source_type: EntityType, source_id: string, target_type: EntityType, target_id: string, relation_type_id?: string | null) => Promise<void>;
  updateRelationType_: (relationId: string, relation_type_id: string | null) => Promise<void>;
  deleteRelation: (id: string) => Promise<void>;

  // Comments (fetched per-entity, not global)
  fetchComments: (entityType: EntityType, entityId: string) => Promise<Comment[]>;
  createComment: (entityType: EntityType, entityId: string, text: string) => Promise<Comment>;
  updateComment: (commentId: string, text: string) => Promise<Comment | null>;
  deleteComment: (commentId: string) => Promise<void>;
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
  categories: [],
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
  listColumnOrder: ["priority", "title", "status", "category", "clients", "type", "due_date", "subtasks"],
  savedFilters: [],
  activeFilterId: null,
  detailMode: "modal" as "modal" | "panel",
  listGroupBy: ["none", "none"] as ListGroupByConfig,

  // App section
  appSection: "tasks" as AppSection,

  // Staging
  stagingItems: [],

  // Clients
  clients: [],
  clientStatuses: [],
  crmSystems: [],
  developmentStages: [],
  allParticipants: [],
  selectedClientId: null,
  isClientDetailOpen: false,
  isCreateClientOpen: false,
  clientSearch: "",
  clientViewMode: "list" as ClientViewMode,
  clientStatusFilter: null,
  clientGroupBy: ["none", "none"] as ClientGroupByConfig,

  // Weekly plans
  weeklyPlans: [],
  currentPlan: null,
  currentPlanId: null,
  currentPlanReport: null,
  unplannedDoneItems: [],

  fetchInit: async () => {
    set({ loading: true });
    const mode = get().subtaskDisplayMode;
    const qs = new URLSearchParams();
    qs.set("archived", "true");
    if (mode === "detached") qs.set("children", "true");
    const res = await fetch(`/api/init?${qs}`);
    if (!res.ok) { set({ loading: false }); return; }
    const data = await res.json();
    const parsed = (data.stagingItems ?? []).map((item: StagingItem) => ({
      ...item,
      parsed_data: JSON.parse(item.parsed_data || "{}") as StagingParsedData,
    }));
    set({
      items: data.items,
      tags: data.tags,
      categories: data.categories,
      clients: data.clients,
      clientStatuses: data.clientStatuses,
      crmSystems: data.crmSystems,
      developmentStages: data.developmentStages,
      allParticipants: data.allParticipants,
      relationTypes: data.relationTypes,
      stagingItems: parsed,
      itemRelationCounts: data.itemRelationCounts,
      itemCommentCounts: data.itemCommentCounts,
      clientRelationCounts: data.clientRelationCounts,
      clientCommentCounts: data.clientCommentCounts,
      itemRelationTitles: data.itemRelationTitles ?? {},
      itemLinkedClients: data.itemLinkedClients ?? {},
      loading: false,
    });
  },

  fetchItems: async () => {
    set({ loading: true });
    const mode = get().subtaskDisplayMode;
    const qs = new URLSearchParams();
    qs.set("archived", "true");
    if (mode === "detached") qs.set("children", "true");
    const res = await fetch(`/api/items?${qs}`);
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

  fetchCategories: async () => {
    const res = await fetch("/api/categories");
    if (!res.ok) return;
    const categories = await res.json();
    set({ categories });
  },

  createCategory: async (name, color, icon) => {
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color, icon }),
    });
    if (!res.ok) throw new Error("Failed to create category");
    const cat: Category = await res.json();
    set((s) => ({ categories: [...s.categories, cat] }));
    return cat;
  },

  updateCategory: async (id, updates) => {
    const res = await fetch(`/api/categories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error("Failed to update category");
    const updated: Category = await res.json();
    set((s) => ({ categories: s.categories.map((c) => c.id === id ? updated : c) }));
  },

  deleteCategory: async (id) => {
    const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete category");
    set((s) => ({ categories: s.categories.filter((c) => c.id !== id) }));
  },

  createItem: async (payload) => {
    const res = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed to create item");
    const item: ItemWithSubtasks = await res.json();
    // Optimistic: add to store without refetch
    if (!item.parent_id) {
      set((s) => ({ items: [item, ...s.items] }));
    } else {
      // Subtask: update parent's subtask list
      set((s) => ({
        items: s.items.map((i) =>
          i.id === item.parent_id
            ? { ...i, subtasks: [...(i.subtasks ?? []), item] }
            : i
        ),
      }));
    }
    return item;
  },

  updateItem: async (id, payload) => {
    const res = await fetch(`/api/items/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed to update item");
    const updated: ItemWithSubtasks = await res.json();
    // Optimistic: replace in store
    set((s) => ({
      items: s.items.map((i) => {
        if (i.id === id) return updated;
        // Also check subtasks
        if (i.subtasks?.some((sub) => sub.id === id)) {
          return { ...i, subtasks: i.subtasks.map((sub) => sub.id === id ? updated : sub) };
        }
        return i;
      }),
    }));
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
    // Only refetch on error to correct state
    if (!res.ok) await get().fetchItems();
  },

  createTag: async (name, color) => {
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    if (!res.ok) throw new Error("Failed to create tag");
    const tag: Tag = await res.json();
    set((s) => ({ tags: [...s.tags, tag] }));
    return tag;
  },

  updateTag: async (id, updates) => {
    const res = await fetch(`/api/tags/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error("Failed to update tag");
    const updated: Tag = await res.json();
    set((s) => ({ tags: s.tags.map((t) => t.id === id ? updated : t) }));
  },

  deleteTag: async (id) => {
    const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    set((s) => ({
      tags: s.tags.filter((t) => t.id !== id),
      items: s.items.map((item) => ({
        ...item,
        tags: item.tags?.filter((t) => t.id !== id),
      })),
    }));
  },

  detachSubtask: async (subtaskId) => {
    const res = await fetch(`/api/items/${subtaskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_id: null }),
    });
    if (!res.ok) return;
    const detached: ItemWithSubtasks = await res.json();
    set((s) => ({
      items: [
        ...s.items.map((i) => ({
          ...i,
          subtasks: i.subtasks?.filter((sub) => sub.id !== subtaskId) ?? [],
        })),
        { ...detached, subtasks: [], tags: detached.tags ?? [], participants: detached.participants ?? [] },
      ],
    }));
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
  resetActiveFilter: () => set({ activeFilterId: null, filters: { ...defaultFilters } }),
  setDetailMode: (detailMode) => set({ detailMode }),
  setAppSection: (appSection) => set({ appSection }),
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

  // Staging
  fetchStagingItems: async () => {
    const res = await fetch("/api/staging?status=pending");
    if (!res.ok) return;
    const items: StagingItem[] = await res.json();
    const parsed: StagingItemParsed[] = items.map((item) => ({
      ...item,
      parsed_data: JSON.parse(item.parsed_data || "{}") as StagingParsedData,
    }));
    set({ stagingItems: parsed });
  },

  approveStagingItem: async (id: string) => {
    const res = await fetch(`/api/staging/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    if (!res.ok) return;
    set({ stagingItems: get().stagingItems.filter((i) => i.id !== id) });
    get().fetchItems();
    get().fetchClients();
  },

  rejectStagingItem: async (id: string) => {
    const res = await fetch(`/api/staging/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject" }),
    });
    if (!res.ok) return;
    set({ stagingItems: get().stagingItems.filter((i) => i.id !== id) });
  },

  updateStagingItem: async (id: string, updates) => {
    const body: Record<string, unknown> = {};
    if (updates.title !== undefined) body.title = updates.title;
    if (updates.description !== undefined) body.description = updates.description;
    if (updates.entity_type !== undefined) body.entity_type = updates.entity_type;
    if (updates.parsed_data !== undefined) body.parsed_data = updates.parsed_data;

    const res = await fetch(`/api/staging/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    const updated: StagingItem = await res.json();
    set({
      stagingItems: get().stagingItems.map((i) =>
        i.id === id ? { ...updated, parsed_data: JSON.parse(updated.parsed_data || "{}") } : i
      ),
    });
  },

  deleteStagingItem: async (id: string) => {
    const res = await fetch(`/api/staging/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    set({ stagingItems: get().stagingItems.filter((i) => i.id !== id) });
  },

  // Clients
  fetchClients: async () => {
    const res = await fetch("/api/clients");
    if (!res.ok) return;
    const clients = await res.json();
    set({ clients });
  },

  fetchClientStatuses: async () => {
    const res = await fetch("/api/client-statuses");
    if (!res.ok) return;
    const clientStatuses = await res.json();
    set({ clientStatuses });
  },

  createClient: async (payload) => {
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed to create client");
    const client: ClientFull = await res.json();
    // Refetch to get full nested data (companies, contacts, etc.)
    await get().fetchClients();
    return client;
  },

  updateClient: async (id, payload) => {
    const res = await fetch(`/api/clients/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed to update client");
    const updated: ClientFull = await res.json();
    set((s) => ({ clients: s.clients.map((c) => c.id === id ? { ...c, ...updated } : c) }));
  },

  deleteClient: async (id) => {
    const res = await fetch(`/api/clients/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    set((s) => ({
      clients: s.clients.filter((c) => c.id !== id),
      isClientDetailOpen: s.selectedClientId === id ? false : s.isClientDetailOpen,
      selectedClientId: s.selectedClientId === id ? null : s.selectedClientId,
    }));
  },

  createClientStatus: async (name, color) => {
    const res = await fetch("/api/client-statuses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    if (!res.ok) throw new Error("Failed to create client status");
    const status: ClientStatus = await res.json();
    set((s) => ({ clientStatuses: [...s.clientStatuses, status] }));
    return status;
  },

  updateClientStatus: async (id, updates) => {
    const res = await fetch(`/api/client-statuses/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) return;
    const updated: ClientStatus = await res.json();
    set((s) => ({
      clientStatuses: s.clientStatuses.map((cs) => cs.id === id ? updated : cs),
      clients: s.clients.map((c) => c.status_id === id ? { ...c, status: updated } : c),
    }));
  },

  deleteClientStatus: async (id) => {
    const res = await fetch(`/api/client-statuses/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    set((s) => ({
      clientStatuses: s.clientStatuses.filter((cs) => cs.id !== id),
      clients: s.clients.map((c) => c.status_id === id ? { ...c, status_id: null, status: null } : c),
    }));
  },

  // CRM systems
  fetchCrmSystems: async () => {
    const res = await fetch("/api/crm-systems");
    if (!res.ok) return;
    const crmSystems = await res.json();
    set({ crmSystems });
  },

  createCrmSystem: async (name) => {
    const res = await fetch("/api/crm-systems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error("Failed to create CRM system");
    const crm: CrmSystem = await res.json();
    set((s) => ({ crmSystems: [...s.crmSystems, crm] }));
    return crm;
  },

  updateCrmSystem: async (id, updates) => {
    const res = await fetch(`/api/crm-systems/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error("Failed to update CRM system");
    const updated: CrmSystem = await res.json();
    set((s) => ({ crmSystems: s.crmSystems.map((c) => c.id === id ? updated : c) }));
  },

  deleteCrmSystem: async (id) => {
    const res = await fetch(`/api/crm-systems/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    set((s) => ({
      crmSystems: s.crmSystems.filter((c) => c.id !== id),
      clients: s.clients.map((cl) => ({
        ...cl,
        crm_systems: cl.crm_systems?.filter((c) => c.id !== id) ?? [],
      })),
    }));
  },

  // Development stages
  fetchDevelopmentStages: async () => {
    const res = await fetch("/api/development-stages");
    if (!res.ok) return;
    set({ developmentStages: await res.json() });
  },
  createDevelopmentStage: async (name) => {
    const res = await fetch("/api/development-stages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (!res.ok) return;
    const stage = await res.json();
    set((s) => ({ developmentStages: [...s.developmentStages, stage] }));
  },
  updateDevelopmentStage: async (id, updates) => {
    const res = await fetch(`/api/development-stages/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
    if (!res.ok) return;
    const updated = await res.json();
    set((s) => ({ developmentStages: s.developmentStages.map((d) => d.id === id ? updated : d) }));
  },
  deleteDevelopmentStage: async (id) => {
    await fetch(`/api/development-stages/${id}`, { method: "DELETE" });
    set((s) => ({ developmentStages: s.developmentStages.filter((d) => d.id !== id) }));
  },

  // Development participants (all)
  fetchAllParticipants: async () => {
    const res = await fetch("/api/development-participants");
    if (!res.ok) return;
    set({ allParticipants: await res.json() });
  },
  createParticipant: async (name) => {
    const res = await fetch("/api/development-participants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (!res.ok) return;
    const p = await res.json();
    set((s) => ({ allParticipants: [...s.allParticipants, p] }));
  },
  updateParticipant: async (id, updates) => {
    const res = await fetch(`/api/development-participants/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
    if (!res.ok) return;
    const updated = await res.json();
    set((s) => ({ allParticipants: s.allParticipants.map((p) => p.id === id ? updated : p) }));
  },
  deleteParticipant: async (id) => {
    await fetch(`/api/development-participants/${id}`, { method: "DELETE" });
    set((s) => ({
      allParticipants: s.allParticipants.filter((p) => p.id !== id),
      items: s.items.map((item) => ({
        ...item,
        participants: item.participants?.filter((p) => p.id !== id),
      })),
    }));
  },

  setClientViewMode: (clientViewMode) => set({ clientViewMode }),
  setClientStatusFilter: (clientStatusFilter) => set({ clientStatusFilter }),
  setClientGroupBy: (clientGroupBy) => {
    if (clientGroupBy[0] === "none") {
      set({ clientGroupBy: ["none", "none"] });
    } else {
      const l2 = clientGroupBy[1] === clientGroupBy[0] ? "none" : clientGroupBy[1];
      set({ clientGroupBy: [clientGroupBy[0], l2] as ClientGroupByConfig });
    }
  },

  reorderClients: async (updates) => {
    const posMap = new Map(updates.map((u) => [u.id, u]));
    set((s) => ({
      clients: s.clients.map((c) => {
        const upd = posMap.get(c.id);
        if (upd) return { ...c, position: upd.position, ...(upd.status_id !== undefined ? { status_id: upd.status_id } : {}) };
        return c;
      }),
    }));
    const res = await fetch("/api/clients", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clients: updates }),
    });
    if (!res.ok) await get().fetchClients();
  },

  openClientDetail: (id) => set({ selectedClientId: id, isClientDetailOpen: true }),
  closeClientDetail: () => set({ isClientDetailOpen: false, selectedClientId: null }),
  openCreateClient: () => set({ isCreateClientOpen: true }),
  closeCreateClient: () => set({ isCreateClientOpen: false }),
  setClientSearch: (clientSearch) => set({ clientSearch }),

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

  // --- Entity counts ---
  itemRelationCounts: {},
  itemCommentCounts: {},
  clientRelationCounts: {},
  clientCommentCounts: {},
  itemRelationTitles: {},
  itemLinkedClients: {},

  fetchEntityCounts: async (entityType) => {
    const res = await fetch(`/api/entity-counts?entity_type=${entityType}`);
    if (!res.ok) return;
    const { relations, comments, relationTitles, linkedClients } = await res.json();
    if (entityType === "item") {
      set({
        itemRelationCounts: relations,
        itemCommentCounts: comments,
        itemRelationTitles: relationTitles ?? {},
        itemLinkedClients: linkedClients ?? {},
      });
    } else {
      set({ clientRelationCounts: relations, clientCommentCounts: comments });
    }
  },

  // --- Relation Types ---
  relationTypes: [],

  fetchRelationTypes: async () => {
    const res = await fetch("/api/relation-types");
    if (!res.ok) return;
    const relationTypes = await res.json();
    set({ relationTypes });
  },

  createRelationType: async (name, color, icon, is_system) => {
    const res = await fetch("/api/relation-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color, icon, is_system }),
    });
    if (!res.ok) throw new Error("Failed to create relation type");
    const rt: RelationType = await res.json();
    set((s) => ({ relationTypes: [...s.relationTypes, rt] }));
    return rt;
  },

  updateRelationType: async (id, updates) => {
    const res = await fetch(`/api/relation-types/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) return;
    const updated: RelationType = await res.json();
    set((s) => ({ relationTypes: s.relationTypes.map((rt) => rt.id === id ? updated : rt) }));
  },

  deleteRelationType: async (id) => {
    const res = await fetch(`/api/relation-types/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    set((s) => ({ relationTypes: s.relationTypes.filter((rt) => rt.id !== id) }));
  },

  // --- Relations ---

  fetchRelations: async (entityType, entityId) => {
    const res = await fetch(`/api/relations?entity_type=${entityType}&entity_id=${entityId}`);
    if (!res.ok) return [];
    return await res.json();
  },

  createRelation: async (source_type, source_id, target_type, target_id, relation_type_id) => {
    await fetch("/api/relations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_type, source_id, target_type, target_id, relation_type_id }),
    });
  },

  updateRelationType_: async (relationId, relation_type_id) => {
    await fetch("/api/relations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: relationId, relation_type_id }),
    });
  },

  deleteRelation: async (id) => {
    await fetch("/api/relations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  },

  // --- Comments ---

  fetchComments: async (entityType, entityId) => {
    const res = await fetch(`/api/comments?entity_type=${entityType}&entity_id=${entityId}`);
    if (!res.ok) return [];
    return await res.json();
  },

  createComment: async (entityType, entityId, text) => {
    const res = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_type: entityType, entity_id: entityId, text }),
    });
    if (!res.ok) throw new Error("Failed to create comment");
    return await res.json();
  },

  updateComment: async (commentId, text) => {
    const res = await fetch("/api/comments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: commentId, text }),
    });
    if (!res.ok) return null;
    return await res.json();
  },

  deleteComment: async (commentId) => {
    await fetch("/api/comments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: commentId }),
    });
  },
}),
  {
    name: "second-brain-settings",
    version: 3,
    storage: createJSONStorage(() => localStorage),
    migrate: (persisted: unknown, version: number) => {
      const state = persisted as Record<string, unknown> | null;
      if (state && version < 3) {
        const cols = state.listColumnOrder as string[] | undefined;
        if (cols) {
          const filtered = cols.filter((c) => c !== "development_stage" && c !== "participants");
          if (!filtered.includes("clients")) {
            const catIdx = filtered.indexOf("category");
            filtered.splice(catIdx >= 0 ? catIdx + 1 : 2, 0, "clients");
          }
          state.listColumnOrder = filtered;
        }
      }
      return state;
    },
    partialize: (state) => ({
      appSection: state.appSection,
      clientViewMode: state.clientViewMode,
      clientGroupBy: state.clientGroupBy,
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
  // Tags are multi-value: "is" means "has this tag", "is_not" means "doesn't have this tag"
  if (cond.field === "tags") {
    const tagIds = item.tags?.map((t) => t.id) ?? [];
    switch (cond.operator) {
      case "is": return tagIds.includes(cond.value);
      case "is_not": return !tagIds.includes(cond.value);
      case "is_empty": return tagIds.length === 0;
      case "is_not_empty": return tagIds.length > 0;
      default: return true;
    }
  }

  if (cond.field === "participants") {
    const participants = item.participants?.map((participant) => participant.name.toLowerCase()) ?? [];
    const target = cond.value.toLowerCase();
    switch (cond.operator) {
      case "is": return participants.includes(target);
      case "is_not": return !participants.includes(target);
      case "contains": return participants.some((name) => name.includes(target));
      case "not_contains": return !participants.some((name) => name.includes(target));
      case "is_empty": return participants.length === 0;
      case "is_not_empty": return participants.length > 0;
      default: return true;
    }
  }

  const fieldValue = (() => {
    switch (cond.field) {
      case "status": return item.status;
      case "priority": return item.priority;
      case "category": return item.category;
      case "type": return item.type;
      case "title": return item.title;
      case "description": return item.description;
      case "development_stage": return item.development_stage ?? "";
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
    if (filters.showArchived && item.status !== "archived") return false;
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

export function useFilteredClients() {
  const clients = useBrainStore((s) => s.clients);
  const search = useBrainStore((s) => s.clientSearch);
  const statusFilter = useBrainStore((s) => s.clientStatusFilter);

  return useMemo(() => {
    return clients.filter((c) => {
      if (statusFilter !== null && c.status_id !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !c.name.toLowerCase().includes(q) &&
          !c.companies?.some((co) => co.name.toLowerCase().includes(q)) &&
          !c.contacts?.some((co) => co.name.toLowerCase().includes(q))
        ) return false;
      }
      return true;
    });
  }, [clients, search, statusFilter]);
}

export function useSelectedClient(): ClientFull | null {
  const clients = useBrainStore((s) => s.clients);
  const selectedId = useBrainStore((s) => s.selectedClientId);
  if (!selectedId) return null;
  return clients.find((c) => c.id === selectedId) ?? null;
}

export function useCategoryConfig(): Record<string, { label: string; icon: string; color: string }> {
  const categories = useBrainStore((s) => s.categories);
  return useMemo(() => {
    const map: Record<string, { label: string; icon: string; color: string }> = {};
    for (const cat of categories) {
      map[cat.id] = { label: cat.name, icon: cat.icon, color: cat.color };
    }
    return map;
  }, [categories]);
}

export function useItemsByStatus(status: ItemStatus): ItemWithSubtasks[] {
  const items = useFilteredItems();
  return useMemo(
    () => items.filter((i) => i.status === status).sort((a, b) => a.position - b.position),
    [items, status]
  );
}
