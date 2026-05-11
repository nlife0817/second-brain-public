"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { usePlanningStore } from "@/lib/planning-store";
import { MetricCard } from "./MetricCard";
import { CreateMetricDrawer } from "./CreateMetricDrawer";

export function MetricColumn() {
  const directionId = usePlanningStore((s) => s.selectedDirectionId);
  const metrics = usePlanningStore((s) => s.metrics).filter((m) => !directionId || m.direction_id === directionId);
  const selectedMetricId = usePlanningStore((s) => s.selectedMetricId);
  const setSelectedMetric = usePlanningStore((s) => s.setSelectedMetric);
  const [openCreate, setOpenCreate] = useState(false);

  return (
    <div className="flex h-full w-[320px] flex-col border-r border-slate-200">
      <div className="flex h-10 items-center justify-between border-b border-slate-200 px-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Метрики</h3>
        <button
          onClick={() => setOpenCreate(true)}
          disabled={!directionId}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
          title="Добавить метрику"
        >
          <Plus className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {metrics.length === 0 ? (
          <div className="mt-8 text-center text-sm text-slate-500">
            <p>Метрик ещё нет.</p>
            <button onClick={() => setOpenCreate(true)} disabled={!directionId} className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50">
              Создать метрику
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {metrics.map((m) => (
              <MetricCard
                key={m.id}
                metric={m}
                selected={m.id === selectedMetricId}
                onSelect={() => setSelectedMetric(m.id)}
              />
            ))}
          </div>
        )}
      </div>
      <CreateMetricDrawer open={openCreate} onClose={() => setOpenCreate(false)} />
    </div>
  );
}
