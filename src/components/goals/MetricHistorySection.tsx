"use client";

// Renamed in spirit to MetricHistorySection — covers all event types
// (snapshot / target_change / manual_edit) and supports edit/delete. File path
// kept for compat with existing imports.

import { useEffect, useState } from "react";
import type { GoalMetric, GoalMetricHistoryEntry } from "@/types";
import {
  History, X, ArrowDown, ArrowUp, Pencil, Trash2, Check, Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useBrainStore } from "@/lib/store";

export function SnapshotHistory({
  goalId,
  metric,
  onClose,
}: {
  goalId: string;
  metric: GoalMetric;
  onClose: () => void;
}) {
  const fetchGoals = useBrainStore((s) => s.fetchGoals);
  const [entries, setEntries] = useState<GoalMetricHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const r = await fetch(`/api/goals/${goalId}/metrics/${metric.id}/history`);
      if (r.ok) {
        const data: GoalMetricHistoryEntry[] = await r.json();
        setEntries(data);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await fetch(`/api/goals/${goalId}/metrics/${metric.id}/history`);
      if (r.ok && !cancelled) {
        const data: GoalMetricHistoryEntry[] = await r.json();
        setEntries(data);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [goalId, metric.id]);

  async function saveEdit(id: string): Promise<void> {
    const n = Number(editValue);
    if (!Number.isFinite(n)) return;
    const r = await fetch(`/api/goals/${goalId}/metrics/${metric.id}/history/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: n }),
    });
    if (r.ok) {
      setEditingId(null);
      await load();
      await fetchGoals();
    }
  }

  async function remove(id: string): Promise<void> {
    if (!confirm("Удалить запись истории?")) return;
    const r = await fetch(`/api/goals/${goalId}/metrics/${metric.id}/history/${id}`, {
      method: "DELETE",
    });
    if (r.ok) {
      await load();
      await fetchGoals();
    }
  }

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50/40 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
          <History className="size-3" /> История изменений
        </span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          <X className="size-3" />
        </button>
      </div>
      {loading && <p className="text-[11px] text-slate-400">Загрузка…</p>}
      {!loading && entries.length === 0 && (
        <p className="text-[11px] text-slate-400">Записей пока нет.</p>
      )}
      {!loading && entries.length > 0 && (
        <div className="max-h-60 space-y-0.5 overflow-y-auto">
          {entries.map((e, i) => {
            const isSnapshot = e.event_type === "snapshot";
            const isTarget = e.event_type === "target_change";
            const prev = entries
              .slice(i + 1)
              .find((p) => p.event_type === e.event_type);
            const delta = isSnapshot && prev?.value != null && e.value != null
              ? Number(e.value) - Number(prev.value)
              : null;
            const positive = delta !== null && delta > 0;
            const negative = delta !== null && delta < 0;
            return (
              <div
                key={e.id}
                className={cn(
                  "flex items-center gap-2 rounded border px-2 py-1 text-[11px]",
                  isTarget ? "border-amber-100 bg-amber-50/40" : "border-slate-100 bg-white",
                )}
              >
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-400">
                  {isTarget ? <Target className="size-2.5" /> : <ArrowUp className="size-2.5" />}
                  {isSnapshot ? "факт" : isTarget ? "план" : "правка"}
                </span>
                {editingId === e.id ? (
                  <>
                    <input
                      type="number"
                      value={editValue}
                      onChange={(ev) => setEditValue(ev.target.value)}
                      className="h-6 w-24 rounded border border-slate-200 px-1.5 text-[11px] tabular-nums"
                      autoFocus
                    />
                    <button
                      onClick={() => saveEdit(e.id)}
                      className="text-emerald-600 hover:text-emerald-700"
                    >
                      <Check className="size-3" />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-slate-400 hover:text-slate-700"
                    >
                      <X className="size-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="tabular-nums font-medium text-slate-800">
                      {e.value == null ? "—" : Number(e.value).toLocaleString("ru-RU")}
                      {metric.unit && <span className="ml-0.5 text-slate-400">{metric.unit}</span>}
                    </span>
                    {isTarget && e.prev_value != null && (
                      <span className="text-[10px] text-slate-400">
                        ← {Number(e.prev_value).toLocaleString("ru-RU")}
                      </span>
                    )}
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
                  </>
                )}
                <span className="ml-auto text-[10px] text-slate-400">
                  {format(new Date(e.recorded_at), "d MMM, HH:mm", { locale: ru })}
                </span>
                {editingId !== e.id && (
                  <>
                    <button
                      onClick={() => {
                        setEditingId(e.id);
                        setEditValue(e.value == null ? "" : String(e.value));
                      }}
                      className="text-slate-300 hover:text-violet-600"
                      title="Редактировать значение"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      onClick={() => remove(e.id)}
                      className="text-slate-300 hover:text-red-500"
                      title="Удалить запись"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </>
                )}
                {e.note && (
                  <span className="basis-full pt-0.5 text-[10px] italic text-slate-500">
                    {e.note}
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
