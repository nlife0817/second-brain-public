"use client";

import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { useTimingStore } from "@/lib/timing-store";

const UNDO_WINDOW_MS = 4_000;
const TICK_MS = 100;

/**
 * Floating "Старый таймер на X остановлен. Отменить" toast — visible for ~4
 * seconds after a mutex_replace. One click resurrects the previous active
 * entry and discards the new (mistaken) one.
 *
 * Hidden inside PiP windows.
 */
export function TimerUndoToast() {
  const pendingUndo = useTimingStore((s) => s.pendingUndo);
  const undoReplace = useTimingStore((s) => s.undoReplace);
  const clearPendingUndo = useTimingStore((s) => s.clearPendingUndo);
  const [, setTick] = useState(0);

  // Tick once per 100ms while a pending undo exists, so the progress bar updates.
  useEffect(() => {
    if (!pendingUndo) return;
    const id = window.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [pendingUndo]);

  // Auto-dismiss after window expires.
  useEffect(() => {
    if (!pendingUndo) return;
    const elapsed = Date.now() - pendingUndo.at;
    const remaining = Math.max(0, UNDO_WINDOW_MS - elapsed);
    const id = window.setTimeout(() => clearPendingUndo(), remaining);
    return () => window.clearTimeout(id);
  }, [pendingUndo, clearPendingUndo]);

  if (typeof window !== "undefined" && (window as unknown as { __sb_isPip?: boolean }).__sb_isPip) {
    return null;
  }
  if (!pendingUndo) return null;

  const elapsed = Date.now() - pendingUndo.at;
  const remaining = Math.max(0, UNDO_WINDOW_MS - elapsed);
  const progress = remaining / UNDO_WINDOW_MS;
  const title = pendingUndo.replaced_item_title ?? "предыдущая задача";

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 bg-slate-900 text-white rounded-lg shadow-lg max-w-md">
        <span className="text-xs">
          Старый таймер{" "}
          <span className="opacity-80">«{title.slice(0, 50)}»</span>{" "}
          остановлен
        </span>
        <button
          type="button"
          onClick={() => void undoReplace()}
          className="flex items-center gap-1 text-xs font-semibold text-blue-300 hover:text-blue-200 transition-colors"
        >
          <Undo2 size={12} />
          Отменить
        </button>
        <div className="w-12 h-1 bg-slate-700 rounded overflow-hidden">
          <div
            className="h-full bg-blue-400 transition-[width] duration-100 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
