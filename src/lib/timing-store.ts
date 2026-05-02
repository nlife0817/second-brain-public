"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ActiveTimerSnapshot,
  PomodoroMode,
  TimeEntry,
  TimingSettings,
} from "@/types";
import { TIMING_SETTINGS_DEFAULTS } from "@/types";

const BROADCAST_CHANNEL = "second-brain-timing";
const STORAGE_KEY = "sb-timing-v1";

interface TimingStore {
  // ----- state -----
  activeEntry: TimeEntry | null;
  itemTitle: string | null;
  /** server_now - client_now (ms). Apply to Date.now() to get a server-aligned clock. */
  serverOffsetMs: number;
  /** ISO timestamp of last meaningful client activity (mousemove / keydown / focus). */
  lastActiveAt: string;
  /** True after the first /api/timing/init fetch resolves. */
  hydrated: boolean;
  /** Whether IdleDialog should be shown. Updated by Phase 3 idle watcher. */
  idlePromptOpen: boolean;
  /** Whether PiP window is currently open. */
  pipOpen: boolean;
  /** Self-time totals per item id (seconds). Refreshed on hydrate / stop. */
  totalsByItem: Record<string, number>;
  /** User's per-account timer settings. */
  settings: Pick<TimingSettings, "idle_threshold_min" | "reminder_interval_min" | "hard_cap_hours" | "default_pomodoro">;

  // ----- actions -----
  hydrate: () => Promise<void>;
  refreshTotals: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  applySnapshot: (snap: ActiveTimerSnapshot, opts?: { broadcast?: boolean }) => void;
  start: (itemId: string, opts?: { pomodoroMode?: PomodoroMode | null; itemTitle?: string }) => Promise<void>;
  stop: (note?: string) => Promise<void>;
  heartbeat: () => Promise<void>;
  touchActive: () => void;
  setIdlePromptOpen: (open: boolean) => void;
  setPipOpen: (open: boolean) => void;
  /** Server-aligned current time in ms. */
  serverNow: () => number;
  /** Elapsed seconds for the active entry (server-aligned). */
  elapsedSeconds: () => number;
}

type BroadcastMessage =
  | { type: "snapshot"; snapshot: ActiveTimerSnapshot }
  | { type: "stopped" }
  | { type: "ping" };

let bc: BroadcastChannel | null = null;
let bcInitialized = false;

function getBC(): BroadcastChannel | null {
  if (bcInitialized) return bc;
  bcInitialized = true;
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  try {
    bc = new BroadcastChannel(BROADCAST_CHANNEL);
  } catch {
    bc = null;
  }
  return bc;
}

function broadcast(msg: BroadcastMessage) {
  const c = getBC();
  if (c) c.postMessage(msg);
}

function makeOptimisticEntry(opts: {
  itemId: string;
  pomodoroMode: PomodoroMode | null;
  startedAt: string;
}): TimeEntry {
  return {
    id: `optimistic-${Date.now()}`,
    user_email: "",
    item_id: opts.itemId,
    started_at: opts.startedAt,
    ended_at: null,
    last_heartbeat_at: opts.startedAt,
    last_active_at: opts.startedAt,
    reminder_sent_at: null,
    note: "",
    source: "manual",
    pomodoro_mode: opts.pomodoroMode,
    pomodoro_phase: opts.pomodoroMode ? "focus" : null,
    created_at: opts.startedAt,
    updated_at: opts.startedAt,
  };
}

interface InitResponse {
  snapshot: ActiveTimerSnapshot;
  settings: TimingSettings;
  totals: Record<string, number>;
}

export const useTimingStore = create<TimingStore>()(
  persist(
    (set, get) => ({
      activeEntry: null,
      itemTitle: null,
      serverOffsetMs: 0,
      lastActiveAt: new Date().toISOString(),
      hydrated: false,
      idlePromptOpen: false,
      pipOpen: false,
      totalsByItem: {},
      settings: { ...TIMING_SETTINGS_DEFAULTS },

      hydrate: async () => {
        try {
          const res = await fetch("/api/timing/init", { cache: "no-store" });
          if (!res.ok) {
            // 401 / 403 — likely on /login. Mark hydrated anyway so we don't loop.
            set({ hydrated: true });
            return;
          }
          const data = (await res.json()) as InitResponse;
          // Apply snapshot (active timer + serverOffsetMs).
          get().applySnapshot(data.snapshot, { broadcast: false });
          // Apply settings + totals from the same response.
          set({
            settings: {
              idle_threshold_min: data.settings.idle_threshold_min,
              reminder_interval_min: data.settings.reminder_interval_min,
              hard_cap_hours: data.settings.hard_cap_hours,
              default_pomodoro: data.settings.default_pomodoro,
            },
            totalsByItem: data.totals,
            hydrated: true,
          });
        } catch {
          set({ hydrated: true });
        }
      },

      refreshSettings: async () => {
        try {
          const res = await fetch("/api/timing/settings", { cache: "no-store" });
          if (!res.ok) return;
          const data = (await res.json()) as TimingSettings;
          set({
            settings: {
              idle_threshold_min: data.idle_threshold_min,
              reminder_interval_min: data.reminder_interval_min,
              hard_cap_hours: data.hard_cap_hours,
              default_pomodoro: data.default_pomodoro,
            },
          });
        } catch {
          // Keep previous settings on failure.
        }
      },

      refreshTotals: async () => {
        try {
          const res = await fetch("/api/timing/totals", { cache: "no-store" });
          if (!res.ok) return;
          const data = (await res.json()) as { totals: Record<string, number> };
          set({ totalsByItem: data.totals });
        } catch {
          // Network blip — keep previous totals.
        }
      },

      applySnapshot: (snap, opts) => {
        const offset = new Date(snap.server_now).getTime() - Date.now();
        set({
          activeEntry: snap.entry,
          itemTitle: snap.item_title,
          serverOffsetMs: offset,
          // If timer just turned off and prompt was open, close it.
          idlePromptOpen: snap.entry ? get().idlePromptOpen : false,
        });
        if (opts?.broadcast !== false) broadcast({ type: "snapshot", snapshot: snap });
      },

      start: async (itemId, opts) => {
        const startedAt = new Date(Date.now() + get().serverOffsetMs).toISOString();
        const pomodoroMode = opts?.pomodoroMode ?? null;
        // Optimistic: replace store immediately so UI reacts.
        const optimistic = makeOptimisticEntry({ itemId, pomodoroMode, startedAt });
        set({
          activeEntry: optimistic,
          itemTitle: opts?.itemTitle ?? get().itemTitle,
          idlePromptOpen: false,
        });
        broadcast({
          type: "snapshot",
          snapshot: {
            entry: optimistic,
            item_title: opts?.itemTitle ?? null,
            server_now: startedAt,
          },
        });

        try {
          const res = await fetch("/api/timing/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ item_id: itemId, pomodoro_mode: pomodoroMode }),
          });
          if (!res.ok) {
            await get().hydrate();
            throw new Error(`start failed: ${res.status}`);
          }
          const snap = (await res.json()) as ActiveTimerSnapshot;
          get().applySnapshot(snap);
          void get().refreshTotals();
        } catch (e) {
          // Hydration above already restored truth from server.
          throw e;
        }
      },

      stop: async (note) => {
        // Optimistic: clear immediately so the widget UI snaps off.
        const previousEntry = get().activeEntry;
        const previousTitle = get().itemTitle;
        set({ activeEntry: null, itemTitle: null, idlePromptOpen: false });
        broadcast({ type: "stopped" });

        try {
          const res = await fetch("/api/timing/stop", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(note != null ? { note } : {}),
          });
          if (res.status === 404) {
            // Server says no active — already aligned with our optimistic clear.
            return;
          }
          if (!res.ok) {
            // Revert: re-hydrate to truth.
            set({ activeEntry: previousEntry, itemTitle: previousTitle });
            await get().hydrate();
            throw new Error(`stop failed: ${res.status}`);
          }
          void get().refreshTotals();
        } catch (e) {
          throw e;
        }
      },

      heartbeat: async () => {
        const active = get().activeEntry;
        if (!active) return;
        // Skip optimistic-only ids (server hasn't confirmed yet).
        if (active.id.startsWith("optimistic-")) return;
        if (typeof document !== "undefined" && document.hidden) return;
        try {
          const res = await fetch("/api/timing/heartbeat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ last_active_at: get().lastActiveAt }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as
            | { active: false; server_now: string }
            | { active: true; entry: TimeEntry; server_now: string };
          if (!data.active) {
            // Server says no active — likely auto-stopped by watchdog.
            await get().hydrate();
            return;
          }
          set({
            activeEntry: data.entry,
            serverOffsetMs: new Date(data.server_now).getTime() - Date.now(),
          });
        } catch {
          // Network blip — ignore; next heartbeat will retry.
        }
      },

      touchActive: () => {
        set({ lastActiveAt: new Date().toISOString() });
      },

      setIdlePromptOpen: (open) => set({ idlePromptOpen: open }),
      setPipOpen: (open) => set({ pipOpen: open }),

      serverNow: () => Date.now() + get().serverOffsetMs,

      elapsedSeconds: () => {
        const active = get().activeEntry;
        if (!active) return 0;
        const startedMs = new Date(active.started_at).getTime();
        return Math.max(0, Math.floor((get().serverNow() - startedMs) / 1000));
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => (typeof window !== "undefined" ? localStorage : ({} as Storage))),
      // Persist only the data that helps render the next page-load instantly.
      // Skip ephemeral flags (hydrated, idlePromptOpen, pipOpen) and
      // serverOffsetMs (it must be re-derived from a fresh /init).
      partialize: (s) => ({
        activeEntry: s.activeEntry,
        itemTitle: s.itemTitle,
        totalsByItem: s.totalsByItem,
        settings: s.settings,
      }),
      version: 1,
    },
  ),
);

// ----------------------------------------------------------------------------
// Cross-tab sync
// ----------------------------------------------------------------------------
if (typeof window !== "undefined") {
  const c = getBC();
  if (c) {
    c.addEventListener("message", (ev) => {
      const msg = ev.data as BroadcastMessage;
      if (msg.type === "snapshot") {
        useTimingStore.getState().applySnapshot(msg.snapshot, { broadcast: false });
      } else if (msg.type === "stopped") {
        useTimingStore.setState({ activeEntry: null, itemTitle: null, idlePromptOpen: false });
      }
    });
  }
}

// ----------------------------------------------------------------------------
// Atomic selectors — use these in components to avoid re-rendering on
// unrelated store changes (e.g. heartbeat updating activeEntry shouldn't
// rerender 100 cards reading totalsByItem).
// ----------------------------------------------------------------------------
export const selectActiveItemId = (s: { activeEntry: TimeEntry | null }) =>
  s.activeEntry?.item_id ?? null;

export const selectIsItemActive = (itemId: string) =>
  (s: { activeEntry: TimeEntry | null }) => s.activeEntry?.item_id === itemId;

export const selectItemTotalSeconds = (itemId: string) =>
  (s: { totalsByItem: Record<string, number> }) => s.totalsByItem[itemId] ?? 0;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
export function formatHMS(totalSec: number): string {
  const sign = totalSec < 0 ? "-" : "";
  const s = Math.abs(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${sign}${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${sign}${m}:${String(sec).padStart(2, "0")}`;
}

export function formatHM(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h}ч ${m}м` : `${h}ч`;
  return `${m}м`;
}
