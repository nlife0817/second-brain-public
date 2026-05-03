"use client";

/**
 * Cross-tab leader election via the Web Locks API.
 *
 * One tab acquires the lock and runs heavy / once-per-user work (heartbeat,
 * idle watcher, sleep notifications). Other tabs sit idle and rely on
 * BroadcastChannel for state updates. When the leader closes / crashes, the
 * browser releases the lock and another tab takes over automatically.
 *
 * Spec: https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
 * Supported in all evergreen browsers since 2022.
 */

const LOCK_NAME = "sb-timing-leader";

type LocksApi = {
  request: (
    name: string,
    options: { mode: "exclusive"; signal?: AbortSignal },
    cb: (lock: unknown) => Promise<unknown>,
  ) => Promise<unknown>;
};

function getLocks(): LocksApi | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as unknown as { locks?: LocksApi };
  return nav.locks ?? null;
}

/**
 * Acquire the timing leader lock. While held, `onAcquired` runs.
 * Returns a cleanup function — call it on component unmount; it aborts the
 * pending request (if not yet leader) and releases the lock (if leader).
 *
 * Falls back to "always leader" in browsers without Web Locks (which would
 * mean every tab acts as leader — same behavior as before this helper).
 */
export function acquireTimingLeadership(
  onAcquired: () => void | (() => void),
): () => void {
  const locks = getLocks();

  if (!locks) {
    // No Web Locks API — degrade to old behavior (every tab is leader).
    const cleanup = onAcquired();
    return () => {
      if (typeof cleanup === "function") cleanup();
    };
  }

  const ac = new AbortController();
  let onRelease: (() => void) | null = null;
  let leaderCleanup: (() => void) | null = null;

  locks
    .request(LOCK_NAME, { mode: "exclusive", signal: ac.signal }, () => {
      // We're the leader. Run setup and hold the lock until released.
      const cb = onAcquired();
      if (typeof cb === "function") leaderCleanup = cb;
      return new Promise<void>((resolve) => {
        onRelease = () => resolve();
      });
    })
    .catch(() => {
      // AbortError on cleanup, or a transient failure — both are safe to ignore.
    });

  return () => {
    if (leaderCleanup) {
      try {
        leaderCleanup();
      } catch {
        /* noop */
      }
      leaderCleanup = null;
    }
    if (onRelease) {
      onRelease();
      onRelease = null;
    } else {
      ac.abort();
    }
  };
}

/**
 * True if the current tab can participate in leader election. False on SSR.
 */
export function hasWebLocks(): boolean {
  return getLocks() !== null;
}
