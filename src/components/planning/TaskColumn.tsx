"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2, ChevronsLeft } from "lucide-react";
import type { Item } from "@/types";
import { usePlanningStore } from "@/lib/planning-store";
import { useBrainStore } from "@/lib/store";
import { CollapsedColumn } from "./CollapsedColumn";
import { TaskLinkPicker } from "./TaskLinkPicker";
import { TaskSelectionList } from "./TaskSelectionList";

// «Задачи инициативы» (правая колонка планирования).
// Визуально/функционально — паритет с разделом «Задачи» (тот же тулбар,
// фильтры, сорт, группировка, колонки) через общий компонент TaskSelectionList,
// но с локальным state — изменения тут НЕ влияют на основной раздел «Задачи».
// Источник задач — useBrainStore.items, отфильтрованный по M:N-связям инициативы.
// Открытие задачи — общий TaskDetailModal (через useBrainStore.openDetail).

export function TaskColumn() {
  const metricId = usePlanningStore((s) => s.selectedMetricId);
  const initiativeId = usePlanningStore((s) => s.selectedInitiativeId);
  const collapsed = usePlanningStore((s) => s.collapsedColumns.includes("tasks"));
  const toggleCollapse = usePlanningStore((s) => s.toggleColumnCollapsed);
  const linkedIds = usePlanningStore((s) => (initiativeId ? s.initiativeItemIds[initiativeId] : undefined));
  const fetchInitiativeItems = usePlanningStore((s) => s.fetchInitiativeItems);

  // Источник правды — flat-список из brain-store: тогда TaskDetailModal
  // увидит задачу в useSelectedItem без дополнительных мостиков.
  const brainItems = useBrainStore((s) => s.items);

  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (initiativeId) void fetchInitiativeItems(initiativeId);
  }, [initiativeId, fetchInitiativeItems]);

  const linkedSet = useMemo(() => new Set(linkedIds ?? []), [linkedIds]);

  // Плоский список из brain-store, отфильтрованный по linkedSet.
  // M:N может включать parent — подзадачи добавляем автоматически.
  const linkedItems: Item[] = useMemo(() => {
    if (!initiativeId) return [];
    const flat: Item[] = [];
    for (const top of brainItems) {
      if (linkedSet.has(top.id)) {
        flat.push(top);
        for (const sub of top.subtasks ?? []) flat.push(sub);
      } else {
        for (const sub of top.subtasks ?? []) {
          if (linkedSet.has(sub.id)) flat.push(sub);
        }
      }
    }
    return flat;
  }, [brainItems, linkedSet, initiativeId]);

  const totalLinked = linkedSet.size;

  if (collapsed) {
    return (
      <CollapsedColumn
        title="Задачи"
        count={totalLinked}
        onExpand={() => toggleCollapse("tasks")}
      />
    );
  }

  if (!initiativeId) {
    return (
      <div className="flex h-full min-w-[440px] flex-1 flex-col">
        <div className="flex h-10 items-center justify-between border-b border-slate-200 px-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Задачи</h3>
          <button
            onClick={() => toggleCollapse("tasks")}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Свернуть колонку"
          >
            <ChevronsLeft className="size-4" />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="max-w-[300px] text-sm text-slate-500">
            {metricId
              ? "Выберите инициативу слева — задачи привязываются к инициативе через M:N."
              : "Сначала выберите метрику, затем инициативу."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-[440px] flex-1 flex-col">
      <div className="flex h-10 items-center justify-between border-b border-slate-200 px-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Задачи инициативы
          </h3>
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">
            {totalLinked}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
            title="Привязать существующие задачи к этой инициативе"
          >
            <Link2 className="size-3.5" /> Привязать
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

      {totalLinked === 0 ? (
        <EmptyState onLink={() => setPickerOpen(true)} />
      ) : (
        <TaskSelectionList
          items={linkedItems}
          storageKey="planning.taskColumn.cols.v2"
          density="compact"
        />
      )}

      {pickerOpen && (
        <TaskLinkPicker
          initiativeId={initiativeId}
          excludeIds={linkedSet}
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function EmptyState({ onLink }: { onLink: () => void }) {
  return (
    <div className="mt-10 px-6 text-center text-sm text-slate-500">
      <p>К этой инициативе ещё не привязано задач.</p>
      <p className="mt-1 text-xs text-slate-400">
        Задачи создаются в основном UI; здесь их привязывают, чтобы видеть скоуп инициативы.
      </p>
      <button
        onClick={onLink}
        className="mt-4 inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
      >
        <Link2 className="size-3.5" /> Привязать существующие
      </button>
    </div>
  );
}
