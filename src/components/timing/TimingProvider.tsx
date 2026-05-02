"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useTimingStore, formatHMS } from "@/lib/timing-store";

const HEARTBEAT_INTERVAL_MS = 30_000;
const TICK_INTERVAL_MS = 1_000;
const ACTIVITY_THROTTLE_MS = 5_000;
const IDLE_CHECK_INTERVAL_MS = 30_000;
const BASE_TITLE = "Second Brain";

function isAppRoute(pathname: string): boolean {
  if (!pathname) return false;
  if (pathname === "/login") return false;
  if (pathname.startsWith("/auth/")) return false;
  return true;
}

function isPipWindow(): boolean {
  if (typeof window === "undefined") return false;
  // Heuristic: PiP window has its own opener via documentPictureInPicture API.
  // The PipTimerWidget mounts inside a portal; this provider should not run inside it.
  return Boolean((window as unknown as { __sb_isPip?: boolean }).__sb_isPip);
}

export function TimingProvider() {
  const pathname = usePathname();
  const enabled = isAppRoute(pathname) && !isPipWindow();

  const hydrate = useTimingStore((s) => s.hydrate);
  const heartbeat = useTimingStore((s) => s.heartbeat);
  const touchActive = useTimingStore((s) => s.touchActive);
  const lastActivityTouchRef = useRef(0);

  // ----- 1. Initial hydration on mount and on visibility change -----
  useEffect(() => {
    if (!enabled) return;
    void hydrate();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void hydrate();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [enabled, hydrate]);

  // ----- 2. Heartbeat interval -----
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      void heartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, heartbeat]);

  // ----- 3. Activity listeners (throttled) -----
  useEffect(() => {
    if (!enabled) return;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastActivityTouchRef.current < ACTIVITY_THROTTLE_MS) return;
      lastActivityTouchRef.current = now;
      touchActive();
    };
    const events: (keyof DocumentEventMap)[] = ["mousemove", "keydown", "click", "touchstart"];
    for (const e of events) document.addEventListener(e, onActivity, { passive: true });
    return () => {
      for (const e of events) document.removeEventListener(e, onActivity);
    };
  }, [enabled, touchActive]);

  // ----- 4. Title bar timer (taskbar approximation #1) -----
  useEffect(() => {
    if (!enabled) {
      if (typeof document !== "undefined") document.title = BASE_TITLE;
      return;
    }
    const id = window.setInterval(() => {
      const { activeEntry, itemTitle, elapsedSeconds } = useTimingStore.getState();
      if (!activeEntry) {
        if (document.title !== BASE_TITLE) document.title = BASE_TITLE;
        return;
      }
      const t = formatHMS(elapsedSeconds());
      const titleSnippet = itemTitle ? itemTitle.slice(0, 40) : "Таймер";
      const next = `▶ ${t} — ${titleSnippet}`;
      if (document.title !== next) document.title = next;
    }, TICK_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      document.title = BASE_TITLE;
    };
  }, [enabled]);

  // ----- 5. Idle watcher: when no activity for idle_threshold_min, prompt user -----
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      const { activeEntry, lastActiveAt, idlePromptOpen, setIdlePromptOpen, settings } =
        useTimingStore.getState();
      if (!activeEntry) return;
      if (idlePromptOpen) return;
      const idleMs = Date.now() - new Date(lastActiveAt).getTime();
      if (idleMs >= settings.idle_threshold_min * 60_000) setIdlePromptOpen(true);
    }, IDLE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled]);

  // ----- 6. App badge (taskbar approximation #2) -----
  useEffect(() => {
    if (!enabled) return;
    type BadgeNav = Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    const nav = (typeof navigator !== "undefined" ? navigator : null) as BadgeNav | null;
    if (!nav?.setAppBadge) return;

    const id = window.setInterval(() => {
      const { activeEntry, elapsedSeconds } = useTimingStore.getState();
      if (!activeEntry) {
        nav.clearAppBadge?.().catch(() => {});
        return;
      }
      const minutes = Math.max(1, Math.floor(elapsedSeconds() / 60));
      nav.setAppBadge?.(minutes).catch(() => {});
    }, 30_000);
    return () => {
      window.clearInterval(id);
      nav.clearAppBadge?.().catch(() => {});
    };
  }, [enabled]);

  return null;
}
