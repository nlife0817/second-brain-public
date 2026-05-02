"use client";

import { create } from "zustand";
import type {
  ActiveTimerSnapshot,
  PomodoroMode,
  TimeEntry,
} from "@/types";

const BROADCAST_CHANNEL = "second-brain-timing";

interface TimingStore {
  // ----- state -----
  activeEntry: TimeEntry | null;
  itemTitle: string | null;
  /** server_now - client_now (ms). Apply to Date.now() to get a server-aligned clock. */
  serverOffsetMs: number;
  /** ISO timestamp of last meaningful client activity (mousemove / keydown / focus). */
  lastActiveAt: string;
  /** True after the first /api/timing/active fetch resolves. */
  hydrated: boolean;
  /** Whether IdleDialog should be shown. Updated by Phase 3 idle watcher. */
  idlePromptOpen: boolean;
  /** Whether PiP window is currently open. */
  pipOpen: boolean;

  // ----- actions -----
  hydrate: () => Promise<void>;
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

export const useTimingStore = create<TimingStore>()((set, get) => ({
  activeEntry: null,
  itemTitle: null,
  serverOffsetMs: 0,
  lastActiveAt: new Date().toISOString(),
  hydrated: false,
  idlePromptOpen: false,
  pipOpen: false,

  hydrate: async () => {
    try {
      const res = await fetch("/api/timing/active", { cache: "no-store" });
      if (!res.ok) {
        // 401 / 403 — likely on /login. Mark hydrated anyway so we don't loop.
        set({ hydrated: true });
        return;
      }
      const snap = (await res.json()) as ActiveTimerSnapshot;
      get().applySnapshot(snap, { broadcast: false });
      set({ hydrated: true });
    } catch {
      set({ hydrated: true });
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
    // Optimistic title update so widget shows new task instantly.
    const optimisticTitle = opts?.itemTitle ?? null;
    if (optimisticTitle) set({ itemTitle: optimisticTitle });

    const res = await fetch("/api/timing/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item_id: itemId, pomodoro_mode: opts?.pomodoroMode ?? null }),
    });
    if (!res.ok) {
      // Revert by re-hydrating.
      await get().hydrate();
      throw new Error(`start failed: ${res.status}`);
    }
    const snap = (await res.json()) as ActiveTimerSnapshot;
    get().applySnapshot(snap);
  },

  stop: async (note) => {
    const res = await fetch("/api/timing/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(note != null ? { note } : {}),
    });
    if (res.status === 404) {
      // No active timer — sync from server anyway.
      await get().hydrate();
      return;
    }
    if (!res.ok) throw new Error(`stop failed: ${res.status}`);
    set({ activeEntry: null, itemTitle: null, idlePromptOpen: false });
    broadcast({ type: "stopped" });
  },

  heartbeat: async () => {
    const active = get().activeEntry;
    if (!active) return;
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
}));

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
