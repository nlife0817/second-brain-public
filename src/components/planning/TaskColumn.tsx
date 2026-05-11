"use client";

import { useState } from "react";
import { Plus, ChevronsLeft } from "lucide-react";
import { usePlanningStore } from "@/lib/planning-store";
import { TaskCard } from "./TaskCard";
import { CreateTaskDrawer } from "./CreateTaskDrawer";
import { CollapsedColumn } from "./CollapsedColumn";

export function TaskColumn() {
  const metricId = usePlanningStore((s) => s.selectedMetricId);
  const initiativeId = usePlanningStore((s) => s.selectedInitiativeId);
  const collapsed = usePlanningStore((s) => s.collapsedColumns.includes("tasks"));
  const toggleCollapse = usePlanningStore((s) => s.toggleColumnCollapsed);
  const tasks = usePlanningStore((s) => s.tasks).filter((t) =>
    initiativeId ? t.initiative_id === initiativeId : false
  );
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");

  if (collapsed) {
    return <CollapsedColumn title="Задачи" count={tasks.length} onExpand={() => toggleCollapse("tasks")} />;
  }

  // Per concept §3 — Tasks live UNDER an Initiative. With no parent selected,
  // there's nothing to show — render a guided empty state instead of leaking
  // all unassigned tasks into this column.
  if (!initiativeId) {
    return (
      <div className="flex h-full min-w-[400px] flex-1 flex-col">
        <div className="flex h-10 items-center justify-between border-b border-slate-200 px-3">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Задачи</h3>
          </div>
          <button
            onClick={() => toggleCollapse("tasks")}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Свернуть колонку"
          >
            <ChevronsLeft className="size-4" />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="max-w-[280px] text-sm text-slate-500">
            {metricId
              ? "Выберите инициативу слева — задачи показываются под конкретной инициативой."
              : "Сначала выберите метрику, затем инициативу. Задачи вложены в инициативу."}
          </p>
        </div>
      </div>
    );
  }

  const filtered = tasks.filter((t) => {
    if (filter === "open") return t.status !== "done";
    if (filter === "done") return t.status === "done";
    return true;
  });
  const doneCount = tasks.filter((t) => t.status === "done").length;

  const tabBase = "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors";
  const tabActive = "bg-slate-900 text-white";
  const tabInactive = "text-slate-500 hover:bg-slate-100";

  return (
    <div className="flex h-full min-w-[400px] flex-1 flex-col">
      <div className="flex h-10 items-center justify-between border-b border-slate-200 px-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Задачи инициативы
          </h3>
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">
            {tasks.length}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setOpen(true)}
            disabled={!initiativeId}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
            title={initiativeId ? "Добавить задачу" : "Сначала выберите инициативу"}
          >
            <Plus className="size-4" />
          </button>
          <button
            onClick={() => toggleCollapse("tasks")}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Свернуть колонку"
          >
            <ChevronsLeft className="size-4" />
          </button>
        </div>
      </div>

      {/* Filter sub-row */}
      {tasks.length > 0 && (
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-1.5">
          <div role="tablist" aria-label="Фильтр задач" className="flex items-center gap-1">
            <button
              role="tab"
              aria-selected={filter === "all"}
              onClick={() => setFilter("all")}
              className={`${tabBase} ${filter === "all" ? tabActive : tabInactive}`}
            >
              Все
            </button>
            <button
              role="tab"
              aria-selected={filter === "open"}
              onClick={() => setFilter("open")}
              className={`${tabBase} ${filter === "open" ? tabActive : tabInactive}`}
            >
              Открытые
            </button>
            <button
              role="tab"
              aria-selected={filter === "done"}
              onClick={() => setFilter("done")}
              className={`${tabBase} ${filter === "done" ? tabActive : tabInactive}`}
            >
              Сделано
            </button>
          </div>
          <span className="text-[10px] text-slate-400 tabular-nums" title="Готовых / всего">
            {doneCount} / {tasks.length}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="mt-8 text-center text-sm text-slate-500">
            <p>
              {!initiativeId
                ? "Сначала выберите инициативу."
                : filter === "done"
                  ? "Готовых задач пока нет."
                  : filter === "open"
                    ? "Открытых задач нет."
                    : "Задач по инициативе нет."}
            </p>
            {initiativeId && filter === "all" && (
              <button
                onClick={() => setOpen(true)}
                className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
              >
                Создать задачу
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((t) => <TaskCard key={t.id} task={t} />)}
          </div>
        )}
      </div>
      <CreateTaskDrawer open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
