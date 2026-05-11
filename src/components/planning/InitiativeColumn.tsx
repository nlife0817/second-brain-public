"use client";

import { useState, useEffect } from "react";
import { Plus, ChevronsLeft } from "lucide-react";
import { usePlanningStore } from "@/lib/planning-store";
import { InitiativeCard } from "./InitiativeCard";
import { CreateInitiativeDrawer } from "./CreateInitiativeDrawer";
import { CollapsedColumn } from "./CollapsedColumn";
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
  const collapsed = usePlanningStore((s) => s.collapsedColumns.includes("initiatives"));
  const toggleCollapse = usePlanningStore((s) => s.toggleColumnCollapsed);
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

  // Per concept §3 — Initiatives live UNDER a Metric. Without a selected metric,
  // there's nothing meaningful to show — render a guided empty state.
  if (!metricId) {
    if (collapsed) {
      return <CollapsedColumn title="Инициативы" count={0} onExpand={() => toggleCollapse("initiatives")} />;
    }
    return (
      <div className="flex h-full w-[380px] shrink-0 flex-col border-r border-slate-200">
        <div className="flex h-10 items-center justify-between border-b border-slate-200 px-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Инициативы</h3>
          <button
            onClick={() => toggleCollapse("initiatives")}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Свернуть колонку"
          >
            <ChevronsLeft className="size-4" />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="max-w-[260px] text-sm text-slate-500">
            Выберите метрику слева — инициативы привязываются к метрике и движут её к цели.
          </p>
        </div>
      </div>
    );
  }

  let initiatives: PlanningInitiative[] = all.filter((i) => !directionId || i.direction_id === directionId);
  if (linkedIds) initiatives = initiatives.filter((i) => linkedIds.has(i.id));

  initiatives = [...initiatives].sort((a, b) =>
    sortMode === "rice"
      ? Number(b.rice_score) - Number(a.rice_score)
      : (a.due_period_id ?? "zzz").localeCompare(b.due_period_id ?? "zzz")
  );

  if (collapsed) {
    return <CollapsedColumn title="Инициативы" count={initiatives.length} onExpand={() => toggleCollapse("initiatives")} />;
  }

  // Concept §20.2.1: «Sort tabs на колонке инициатив: «По дедлайну» (default) / «По RICE»».
  const tabBase = "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors";
  const tabActive = "bg-slate-900 text-white";
  const tabInactive = "text-slate-500 hover:bg-slate-100";

  return (
    <div className="flex h-full w-[380px] shrink-0 flex-col border-r border-slate-200">
      <div className="flex h-10 items-center justify-between border-b border-slate-200 px-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Инициативы</h3>
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">{initiatives.length}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setOpen(true)}
            disabled={!directionId}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
            title={directionId ? "Добавить инициативу" : "Сначала выберите направление"}
          >
            <Plus className="size-4" />
          </button>
          <button
            onClick={() => toggleCollapse("initiatives")}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Свернуть колонку"
          >
            <ChevronsLeft className="size-4" />
          </button>
        </div>
      </div>

      {/* Sub-row: sort tabs + archive toggle */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-1.5">
        <div role="tablist" aria-label="Сортировка инициатив" className="flex items-center gap-1">
          <button
            role="tab"
            aria-selected={sortMode === "deadline"}
            onClick={() => setSort("deadline")}
            className={`${tabBase} ${sortMode === "deadline" ? tabActive : tabInactive}`}
            title="Сортировка по дедлайну (по умолчанию)"
          >
            По дедлайну
          </button>
          <button
            role="tab"
            aria-selected={sortMode === "rice"}
            onClick={() => setSort("rice")}
            className={`${tabBase} ${sortMode === "rice" ? tabActive : tabInactive}`}
            title="Сортировка по RICE-score"
          >
            По RICE
          </button>
        </div>
        <button
          onClick={() => setShowArchived(!showArchived)}
          className={`rounded-md px-1.5 py-0.5 text-[10px] transition-colors ${
            showArchived ? "bg-slate-200 text-slate-700" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          }`}
          title="Показывать архивные инициативы (>30 дней done)"
        >
          {showArchived ? "Архив виден" : "Архив скрыт"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {initiatives.length === 0 ? (
          <div className="mt-8 text-center text-sm text-slate-500">
            <p>{metricId ? "По выбранной метрике инициатив нет." : "Инициатив нет."}</p>
            <button
              onClick={() => setOpen(true)}
              disabled={!directionId}
              className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
            >
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
