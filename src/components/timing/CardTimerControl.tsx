"use client";

import { useEffect, useState } from "react";
import { Play, Square, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useTimingStore,
  formatHM,
  formatHMS,
  selectIsItemActive,
  selectItemTotalSeconds,
} from "@/lib/timing-store";

/**
 * Compact timer control rendered next to task date on cards / list rows.
 * Shows:
 *   - if this item is the active timer: pulsing dot + live HH:MM + Stop button (always visible).
 *   - otherwise: total tracked time badge (if > 0) + ▶ button (visible on parent hover/focus).
 *
 * Atomic selectors: each instance subscribes only to its own item's totals
 * and to the active-or-not flag — heartbeat ticks won't rerender 100 cards.
 */
export function CardTimerControl({
  itemId,
  itemTitle,
  /** Container will toggle .group, so child uses group-hover. */
  alwaysShowStartButton = false,
  /** Tailwind group variant suffix, e.g. "card" → group-hover/card. Empty = anonymous group. */
  hoverGroup,
  className,
}: {
  itemId: string;
  itemTitle?: string;
  alwaysShowStartButton?: boolean;
  hoverGroup?: string;
  className?: string;
}) {
  const isActive = useTimingStore(selectIsItemActive(itemId));
  const totalSec = useTimingStore(selectItemTotalSeconds(itemId));
  const hasOtherActive = useTimingStore(
    (s) => s.activeEntry !== null && s.activeEntry.item_id !== itemId,
  );

  const start = useTimingStore((s) => s.start);
  const stop = useTimingStore((s) => s.stop);

  const [busy, setBusy] = useState(false);

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
    return <ActiveTimerBadge onStop={handleStop} busy={busy} className={className} />;
  }

  const hasTotal = totalSec > 0;

  // Tailwind v4 needs static class strings — enumerate the supported variants.
  const hoverVariantClass =
    hoverGroup === "card"
      ? "opacity-0 group-hover/card:opacity-100 transition-opacity"
      : hoverGroup === "row"
        ? "opacity-0 group-hover/row:opacity-100 transition-opacity"
        : "opacity-0 group-hover:opacity-100 transition-opacity";
  const hideUnlessHover = !hasTotal && !alwaysShowStartButton ? hoverVariantClass : "";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] text-slate-500",
        hideUnlessHover,
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {hasTotal && (
        <span
          className="font-mono tabular-nums rounded bg-slate-100 px-1 py-0.5"
          title={`Всего по задаче: ${formatHM(Math.round(totalSec / 60))}`}
        >
          {formatHM(Math.round(totalSec / 60))}
        </span>
      )}
      <button
        type="button"
        onClick={handleStart}
        disabled={busy}
        aria-label="Запустить таймер"
        title={hasOtherActive ? "Переключить таймер на эту задачу" : "Запустить таймер"}
        className={cn(
          "inline-flex size-5 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-900",
          hideUnlessHover,
        )}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ActiveTimerBadge — extracted so only THIS instance re-renders every second
// while the active item ticks. Other CardTimerControl instances stay still.
// ---------------------------------------------------------------------------
function ActiveTimerBadge({
  onStop,
  busy,
  className,
}: {
  onStop: (e: React.MouseEvent) => void;
  busy: boolean;
  className?: string;
}) {
  const elapsedFn = useTimingStore((s) => s.elapsedSeconds);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
      <span className="font-mono tabular-nums">{formatHMS(elapsedFn())}</span>
      <button
        type="button"
        onClick={onStop}
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
