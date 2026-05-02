"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Square, Loader2 } from "lucide-react";
import { useTimingStore, formatHMS } from "@/lib/timing-store";

/**
 * Slim sticky bar shown at the top of /m/* layouts when a timer is running.
 * Hidden when there is no active timer (mobile users start timers on the
 * desktop UI; this bar is purely a visibility/anti-forgetting indicator).
 */
export function MobileTimerBar() {
  const hasActive = useTimingStore((s) => s.activeEntry !== null);
  const activeItemId = useTimingStore((s) => s.activeEntry?.item_id ?? null);
  const itemTitle = useTimingStore((s) => s.itemTitle);
  const stop = useTimingStore((s) => s.stop);
  const elapsedFn = useTimingStore((s) => s.elapsedSeconds);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!hasActive) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [hasActive]);

  if (!hasActive || !activeItemId) return null;

  const handleStop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stop();
    } catch (e) {
      console.error("[timing mobile] stop failed", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sticky top-0 z-40 flex items-center gap-2 border-b border-emerald-200 bg-emerald-50/95 backdrop-blur px-3 py-1.5 text-emerald-900">
      <span aria-hidden className="size-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
      <Link
        href={`/m/tasks?item=${activeItemId}`}
        className="flex-1 min-w-0 text-xs truncate"
        title={itemTitle ?? undefined}
      >
        {itemTitle ?? "Задача"}
      </Link>
      <span className="font-mono tabular-nums text-sm font-medium shrink-0">
        {formatHMS(elapsedFn())}
      </span>
      <button
        type="button"
        onClick={handleStop}
        disabled={busy}
        aria-label="Остановить таймер"
        className="inline-flex size-7 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 active:bg-emerald-200"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
      </button>
    </div>
  );
}
