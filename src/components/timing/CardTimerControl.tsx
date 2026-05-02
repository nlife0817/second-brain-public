"use client";

import { useEffect, useState } from "react";
import { Play, Square, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTimingStore, formatHM, formatHMS } from "@/lib/timing-store";

/**
 * Compact timer control rendered next to task date on cards / list rows.
 * Shows:
 *   - if this item is the active timer: pulsing dot + live HH:MM + Stop button (always visible).
 *   - otherwise: total tracked time badge (if > 0) + ▶ button (visible on parent hover/focus).
 */
export function CardTimerControl({
  itemId,
  itemTitle,
  /** Container will toggle .group, so child uses group-hover. */
  alwaysShowStartButton = false,
  className,
}: {
  itemId: string;
  itemTitle?: string;
  alwaysShowStartButton?: boolean;
  className?: string;
}) {
  const activeEntry = useTimingStore((s) => s.activeEntry);
  const totals = useTimingStore((s) => s.totalsByItem);
  const start = useTimingStore((s) => s.start);
  const stop = useTimingStore((s) => s.stop);
  const elapsedFn = useTimingStore((s) => s.elapsedSeconds);

  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  const isActive = activeEntry?.item_id === itemId;

  // Re-render every second while active to advance the live timer.
  useEffect(() => {
    if (!isActive) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [isActive]);

  const totalSec = totals[itemId] ?? 0;
  // Live total when active.
  const displaySec = isActive ? totalSec - secondsForActiveBefore() + elapsedFn() : totalSec;

  function secondsForActiveBefore(): number {
    // Rough: totals from server are last-refreshed snapshot. The active
    // session's contribution to totals is whatever the server saw at that time.
    // For UI purposes, simply ignore this nuance — totals refresh on stop, and
    // the live elapsed is shown next to the dot anyway.
    return 0;
  }

  const handleStart = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await start(itemId, { itemTitle });
    } catch (err) {
      console.error("[timing card] start failed", err);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await stop();
    } catch (err) {
      console.error("[timing card] stop failed", err);
    } finally {
      setBusy(false);
    }
  };

  if (isActive) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-emerald-500 animate-pulse"
        />
        <span className="font-mono tabular-nums">{formatHMS(elapsedFn())}</span>
        <button
          type="button"
          onClick={handleStop}
          disabled={busy}
          aria-label="Остановить таймер"
          title="Остановить"
          className="ml-0.5 inline-flex size-4 items-center justify-center rounded text-emerald-700 hover:bg-emerald-100"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3" />}
        </button>
      </span>
    );
  }

  const hasTotal = totalSec > 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] text-slate-500",
        !hasTotal && !alwaysShowStartButton && "opacity-0 group-hover:opacity-100 transition-opacity",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {hasTotal && (
        <span
          className="font-mono tabular-nums rounded bg-slate-100 px-1 py-0.5"
          title={`Всего по задаче: ${formatHM(Math.round(displaySec / 60))}`}
        >
          {formatHM(Math.round(displaySec / 60))}
        </span>
      )}
      <button
        type="button"
        onClick={handleStart}
        disabled={busy}
        aria-label="Запустить таймер"
        title={activeEntry ? "Переключить таймер на эту задачу" : "Запустить таймер"}
        className={cn(
          "inline-flex size-5 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-900",
          !hasTotal && !alwaysShowStartButton && "opacity-0 group-hover:opacity-100",
        )}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
      </button>
    </span>
  );
}
