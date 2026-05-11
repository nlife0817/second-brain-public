"use client";

import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { usePlanningStore } from "@/lib/planning-store";
import { InitiativeCard } from "./InitiativeCard";
import { CreateInitiativeDrawer } from "./CreateInitiativeDrawer";
import type { PlanningInitiative } from "@/types/planning";

export function InitiativeColumn() {
  const directionId = usePlanningStore((s) => s.selectedDirectionId);
  const metricId = usePlanningStore((s) => s.selectedMetricId);
  const showArchived = usePlanningStore((s) => s.showArchived);
  const setShowArchived = usePlanningStore((s) => s.setShowArchived);
  const sortMode = usePlanningStore((s) => s.initiativeSort);
  const setSort = usePlanningStore((s) => s.setInitiativeSort);
  const all = usePlanningStore((s) => s.initiatives);
  const selectedId = usePlanningStore((s) => s.selectedInitiativeId);
  const setSelected = usePlanningStore((s) => s.setSelectedInitiative);
  const [open, setOpen] = useState(false);
  const [linkedIds, setLinkedIds] = useState<Set<string> | null>(null);

  // Load metric links when a metric is selected
  useEffect(() => {
    if (!metricId) return;
    let cancelled = false;
    Promise.all(all.map((i) => fetch(`/api/planning/initiatives/${i.id}`).then((r) => r.ok ? r.json() : null)))
      .then((rows) => {
        if (cancelled) return;
        const ids = new Set<string>();
        for (const row of rows) {
          if (row?.linked_metrics?.some((l: { metric_id: string }) => l.metric_id === metricId)) {
            ids.add(row.id);
          }
        }
        setLinkedIds(ids);
      });
    return () => { cancelled = true; setLinkedIds(null); };
  }, [metricId, all]);

  let initiatives: PlanningInitiative[] = all.filter((i) => !directionId || i.direction_id === directionId);
  if (linkedIds) initiatives = initiatives.filter((i) => linkedIds.has(i.id));

  initiatives = [...initiatives].sort((a, b) =>
    sortMode === "rice"
      ? Number(b.rice_score) - Number(a.rice_score)
      : (a.due_period_id ?? "zzz").localeCompare(b.due_period_id ?? "zzz")
  );

  return (
    <div className="flex h-full w-[380px] flex-col border-r border-slate-200">
      <div className="flex h-10 items-center justify-between border-b border-slate-200 px-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Инициативы</h3>
          <button onClick={() => setSort(sortMode === "rice" ? "deadline" : "rice")} className="rounded-md px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100" title="Переключить сортировку">
            {sortMode === "rice" ? "RICE" : "Дедлайн"}
          </button>
          <button onClick={() => setShowArchived(!showArchived)} className={`rounded-md px-1.5 py-0.5 text-[10px] ${showArchived ? "bg-slate-200 text-slate-700" : "text-slate-400 hover:bg-slate-100"}`} title="Архив">
            Архив
          </button>
        </div>
        <button onClick={() => setOpen(true)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Добавить инициативу">
          <Plus className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {initiatives.length === 0 ? (
          <div className="mt-8 text-center text-sm text-slate-500">
            <p>Инициатив нет.</p>
            <button onClick={() => setOpen(true)} className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700">
              Создать инициативу
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {initiatives.map((i) => (
              <InitiativeCard
                key={i.id}
                initiative={i}
                selected={i.id === selectedId}
                onSelect={() => setSelected(i.id)}
              />
            ))}
          </div>
        )}
      </div>
      <CreateInitiativeDrawer open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
