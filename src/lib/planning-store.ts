"use client";

import { create } from "zustand";
import { toast } from "sonner";
import type {
  PlanningDirection,
  PlanningMetric,
  PlanningInitiative,
  PlanningSettings,
  PlanningInitiativeMetricLink,
} from "@/types/planning";
import type { Item } from "@/types";

type SortMode = "deadline" | "rice";

interface PlanningStore {
  // Data
  directions: PlanningDirection[];
  metrics: PlanningMetric[];
  initiatives: PlanningInitiative[];
  initiativeMetricLinks: PlanningInitiativeMetricLink[];
  tasks: Item[];
  settings: PlanningSettings | null;

  // Selection state for Miller columns
  selectedDirectionId: string | null;
  selectedMetricId: string | null;
  selectedInitiativeId: string | null;
  showArchived: boolean;
  initiativeSort: SortMode;

  // Loading
  loaded: boolean;

  // Actions
  fetchAll: () => Promise<void>;

  setSelectedDirection: (id: string | null) => void;
  setSelectedMetric: (id: string | null) => void;
  setSelectedInitiative: (id: string | null) => void;
  setShowArchived: (v: boolean) => void;
  setInitiativeSort: (s: SortMode) => void;

  createDirection: (input: { title: string; year_focus?: string }) => Promise<PlanningDirection | null>;
  createMetric: (input: { title: string; type: PlanningMetric["type"]; unit?: string; direction_id?: string | null }) => Promise<PlanningMetric | null>;
  createInitiative: (input: { title: string; type: PlanningInitiative["type"]; linked_metric_ids?: string[]; direction_id?: string | null }) => Promise<PlanningInitiative | null>;
  createTask: (input: { title: string; why?: string; initiative_id?: string | null }) => Promise<Item | null>;

  updateMetric: (id: string, updates: Partial<PlanningMetric>) => Promise<void>;
  updateInitiative: (id: string, updates: Partial<PlanningInitiative>) => Promise<void>;
  updateTask: (id: string, updates: Partial<Item>) => Promise<void>;
  updateDirection: (id: string, updates: Partial<PlanningDirection>) => Promise<void>;
}

async function jsonOrNull<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  try { return (await res.json()) as T; } catch { return null; }
}

export const usePlanningStore = create<PlanningStore>((set, get) => ({
  directions: [],
  metrics: [],
  initiatives: [],
  initiativeMetricLinks: [],
  tasks: [],
  settings: null,
  selectedDirectionId: null,
  selectedMetricId: null,
  selectedInitiativeId: null,
  showArchived: false,
  initiativeSort: "deadline",
  loaded: false,

  fetchAll: async () => {
    const [dirRes, metRes, iniRes, setRes, taskRes] = await Promise.all([
      fetch("/api/planning/directions"),
      fetch("/api/planning/metrics"),
      fetch(`/api/planning/initiatives?include_archived=${get().showArchived ? "1" : "0"}`),
      fetch("/api/planning/settings"),
      fetch("/api/items"),
    ]);
    const directions = (await jsonOrNull<PlanningDirection[]>(dirRes)) ?? [];
    const metrics = (await jsonOrNull<PlanningMetric[]>(metRes)) ?? [];
    const initiatives = (await jsonOrNull<PlanningInitiative[]>(iniRes)) ?? [];
    const settings = await jsonOrNull<PlanningSettings>(setRes);
    const tasks = ((await jsonOrNull<Item[]>(taskRes)) ?? []).filter((i) => i.type === "task");

    // Collect metric-initiative links — fetch per initiative is too chatty for now; rely on /initiatives/[id] when needed.
    set({ directions, metrics, initiatives, tasks, settings, loaded: true });
    if (!get().selectedDirectionId && directions[0]) {
      set({ selectedDirectionId: directions[0].id });
    }
  },

  setSelectedDirection: (id) => set({ selectedDirectionId: id, selectedMetricId: null, selectedInitiativeId: null }),
  setSelectedMetric: (id) => set({ selectedMetricId: id, selectedInitiativeId: null }),
  setSelectedInitiative: (id) => set({ selectedInitiativeId: id }),
  setShowArchived: (v) => { set({ showArchived: v }); get().fetchAll(); },
  setInitiativeSort: (s) => set({ initiativeSort: s }),

  createDirection: async (input) => {
    const res = await fetch("/api/planning/directions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const row = await jsonOrNull<PlanningDirection>(res);
    if (!row) { toast.error("Не удалось создать направление"); return null; }
    set((s) => ({ directions: [...s.directions, row], selectedDirectionId: row.id }));
    return row;
  },

  createMetric: async (input) => {
    const res = await fetch("/api/planning/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        direction_id: input.direction_id ?? get().selectedDirectionId,
      }),
    });
    const row = await jsonOrNull<PlanningMetric>(res);
    if (!row) { toast.error("Не удалось создать метрику"); return null; }
    set((s) => ({ metrics: [...s.metrics, row], selectedMetricId: row.id }));
    return row;
  },

  createInitiative: async (input) => {
    const res = await fetch("/api/planning/initiatives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        direction_id: input.direction_id ?? get().selectedDirectionId,
        linked_metric_ids: input.linked_metric_ids ?? (get().selectedMetricId ? [get().selectedMetricId] : []),
      }),
    });
    const row = await jsonOrNull<PlanningInitiative>(res);
    if (!row) { toast.error("Не удалось создать инициативу"); return null; }
    set((s) => ({ initiatives: [...s.initiatives, row], selectedInitiativeId: row.id }));
    return row;
  },

  createTask: async (input) => {
    const id = crypto.randomUUID();
    const res = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        title: input.title,
        description: "",
        type: "task",
        status: "todo",
        priority: "none",
        category: "development",
        source: "system",
        why: input.why,
        initiative_id: input.initiative_id ?? get().selectedInitiativeId,
      }),
    });
    const row = await jsonOrNull<Item>(res);
    if (!row) { toast.error("Не удалось создать задачу"); return null; }
    set((s) => ({ tasks: [...s.tasks, row] }));
    return row;
  },

  updateDirection: async (id, updates) => {
    const before = get().directions.find((d) => d.id === id);
    if (!before) return;
    set((s) => ({ directions: s.directions.map((d) => d.id === id ? { ...d, ...updates } : d) }));
    const res = await fetch(`/api/planning/directions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      set((s) => ({ directions: s.directions.map((d) => d.id === id ? before : d) }));
      toast.error("Изменения не сохранены");
    }
  },

  updateMetric: async (id, updates) => {
    const before = get().metrics.find((m) => m.id === id);
    if (!before) return;
    set((s) => ({ metrics: s.metrics.map((m) => m.id === id ? { ...m, ...updates } : m) }));
    const res = await fetch(`/api/planning/metrics/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      set((s) => ({ metrics: s.metrics.map((m) => m.id === id ? before : m) }));
      toast.error("Изменения не сохранены");
    }
  },

  updateInitiative: async (id, updates) => {
    const before = get().initiatives.find((i) => i.id === id);
    if (!before) return;
    set((s) => ({ initiatives: s.initiatives.map((i) => i.id === id ? { ...i, ...updates } : i) }));
    const res = await fetch(`/api/planning/initiatives/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      set((s) => ({ initiatives: s.initiatives.map((i) => i.id === id ? before : i) }));
      toast.error("Изменения не сохранены");
    }
  },

  updateTask: async (id, updates) => {
    const before = get().tasks.find((t) => t.id === id);
    if (!before) return;
    set((s) => ({ tasks: s.tasks.map((t) => t.id === id ? { ...t, ...updates } : t) }));
    const res = await fetch(`/api/items/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      set((s) => ({ tasks: s.tasks.map((t) => t.id === id ? before : t) }));
      toast.error("Изменения не сохранены");
    }
  },
}));
