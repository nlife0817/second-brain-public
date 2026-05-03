"use client";

import { useEffect, useState } from "react";
import type { GoalMetric, GoalMetricSnapshot } from "@/types";
import { History, X, ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

export function SnapshotHistory({
  goalId,
  metric,
  onClose,
}: {
  goalId: string;
  metric: GoalMetric;
  onClose: () => void;
}) {
  const [snaps, setSnaps] = useState<GoalMetricSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/goals/${goalId}/metrics/${metric.id}/snapshot`);
        if (r.ok) {
          const data: GoalMetricSnapshot[] = await r.json();
          if (!cancelled) setSnaps(data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [goalId, metric.id]);

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50/40 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
          <History className="size-3" /> История значений
        </span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          <X className="size-3" />
        </button>
      </div>
      {loading && <p className="text-[11px] text-slate-400">Загрузка…</p>}
      {!loading && snaps.length === 0 && (
        <p className="text-[11px] text-slate-400">Записей пока нет.</p>
      )}
      {!loading && snaps.length > 0 && (
        <div className="max-h-60 space-y-0.5 overflow-y-auto">
          {snaps.map((s, i) => {
            const prev = snaps[i + 1];
            const delta = prev ? Number(s.value) - Number(prev.value) : null;
            const positive = delta !== null && delta > 0;
            const negative = delta !== null && delta < 0;
            return (
              <div
                key={s.id}
                className="flex items-center gap-2 rounded border border-slate-100 bg-white px-2 py-1 text-[11px]"
              >
                <span className="tabular-nums font-medium text-slate-800">
                  {Number(s.value).toLocaleString("ru-RU")}
                  {metric.unit && <span className="ml-0.5 text-slate-400">{metric.unit}</span>}
                </span>
                {delta !== null && delta !== 0 && (
                  <span
                    className={cn(
                      "flex items-center gap-0.5 text-[10px] tabular-nums",
                      positive && "text-emerald-600",
                      negative && "text-red-500",
                    )}
                  >
                    {positive ? <ArrowUp className="size-2.5" /> : <ArrowDown className="size-2.5" />}
                    {Math.abs(delta).toLocaleString("ru-RU")}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-slate-400">
                  {format(new Date(s.recorded_at), "d MMM, HH:mm", { locale: ru })}
                </span>
                {s.note && (
                  <span className="basis-full pt-0.5 text-[10px] italic text-slate-500">
                    {s.note}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
