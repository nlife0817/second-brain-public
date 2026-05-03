"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useTimingStore, formatHMS } from "@/lib/timing-store";
import { acquireTimingLeadership } from "@/lib/timing-leader";

const HEARTBEAT_INTERVAL_MS = 30_000;
const ACTIVITY_THROTTLE_MS = 5_000;
const IDLE_CHECK_INTERVAL_MS = 30_000;
const BADGE_INTERVAL_MS = 30_000;
const SLEEP_THRESHOLD_MS = 30_000;
const BASE_TITLE = "Second Brain";

function isAppRoute(pathname: string): boolean {
  if (!pathname) return false;
  if (pathname === "/login") return false;
  if (pathname.startsWith("/auth/")) return false;
  return true;
}

function isPipWindow(): boolean {
  if (typeof window === "undefined") return false;
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

  // ----- 2. Activity listeners (throttled) -----
  // These run in every tab — UI everywhere should know about local activity
  // for the purposes of suppressing the local idle dialog.
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

  // ----- 3. Web Worker tick + sleep detection (per-tab — UI rendering) -----
  // The worker keeps a stable 1-Hz tick even when the tab is throttled, and
  // emits a `sleep_detected` message when Date.now() jumped (laptop closed
  // for hours). The store re-derives elapsed via Date.now() so we just need
  // a re-render trigger and the sleep notification.
  useEffect(() => {
    if (!enabled) return;
    let worker: Worker | null = null;
    try {
      worker = new Worker("/timing-worker.js");
    } catch (e) {
      console.error("[timing] worker failed to load", e);
      return;
    }

    worker.onmessage = (ev) => {
      const data = ev.data as { type: string; drift?: number };
      if (data.type === "tick") {
        // Re-render title/badge by reading store; updates handled in their own effects below via setInterval-like reads.
        const s = useTimingStore.getState();
        if (!s.activeEntry) {
          if (typeof document !== "undefined" && document.title !== BASE_TITLE) {
            document.title = BASE_TITLE;
          }
          return;
        }
        const t = formatHMS(s.elapsedSeconds());
        const titleSnippet = s.itemTitle ? s.itemTitle.slice(0, 40) : "Таймер";
        const next = `▶ ${t} — ${titleSnippet}`;
        if (typeof document !== "undefined" && document.title !== next) {
          document.title = next;
        }
      } else if (data.type === "sleep_detected") {
        // Computer was likely asleep — re-pull truth from server and prompt user.
        void hydrate();
        const s = useTimingStore.getState();
        if (s.activeEntry) s.setIdlePromptOpen(true);
      }
    };

    worker.postMessage({
      type: "start",
      tickMs: 1000,
      sleepThresholdMs: SLEEP_THRESHOLD_MS,
    });

    return () => {
      worker?.postMessage({ type: "stop" });
      worker?.terminate();
      if (typeof document !== "undefined") document.title = BASE_TITLE;
    };
  }, [enabled, hydrate]);

  // ----- 4. Leader-only work: heartbeat + idle watcher + app badge -----
  // Only one tab runs these; others are followers fed by BroadcastChannel.
  useEffect(() => {
    if (!enabled) return;
    const release = acquireTimingLeadership(() => {
      const intervals: number[] = [];

      // Heartbeat
      intervals.push(window.setInterval(() => {
        void heartbeat();
      }, HEARTBEAT_INTERVAL_MS));

      // Idle watcher
      intervals.push(window.setInterval(() => {
        const { activeEntry, lastActiveAt, idlePromptOpen, setIdlePromptOpen, settings } =
          useTimingStore.getState();
        if (!activeEntry) return;
        if (idlePromptOpen) return;
        const idleMs = Date.now() - new Date(lastActiveAt).getTime();
        if (idleMs >= settings.idle_threshold_min * 60_000) setIdlePromptOpen(true);
      }, IDLE_CHECK_INTERVAL_MS));

      // App badge
      type BadgeNav = Navigator & {
        setAppBadge?: (n?: number) => Promise<void>;
        clearAppBadge?: () => Promise<void>;
      };
      const nav = (typeof navigator !== "undefined" ? navigator : null) as BadgeNav | null;
      if (nav?.setAppBadge) {
        intervals.push(window.setInterval(() => {
          const { activeEntry, elapsedSeconds } = useTimingStore.getState();
          if (!activeEntry) {
            nav.clearAppBadge?.().catch(() => {});
            return;
          }
          const minutes = Math.max(1, Math.floor(elapsedSeconds() / 60));
          nav.setAppBadge?.(minutes).catch(() => {});
        }, BADGE_INTERVAL_MS));
      }

      return () => {
        for (const id of intervals) window.clearInterval(id);
        if (nav?.clearAppBadge) nav.clearAppBadge().catch(() => {});
      };
    });

    return release;
  }, [enabled, heartbeat]);

  // ----- 5. Final heartbeat on tab close (sendBeacon) -----
  // Without this, watchdog auto-stops at last_heartbeat_at — which may be up
  // to 30 seconds stale. sendBeacon is the only reliable way to fire a
  // request during pagehide; cookies are included by default.
  useEffect(() => {
    if (!enabled) return;
    const onPageHide = () => {
      const { activeEntry, lastActiveAt } = useTimingStore.getState();
      if (!activeEntry) return;
      if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
      try {
        const blob = new Blob(
          [JSON.stringify({ last_active_at: lastActiveAt })],
          { type: "application/json" },
        );
        navigator.sendBeacon("/api/timing/heartbeat", blob);
      } catch {
        /* best-effort, swallow */
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [enabled]);

  return null;
}
