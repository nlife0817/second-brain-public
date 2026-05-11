"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2, ChevronsLeft, ChevronRight } from "lucide-react";
import type { Item, ItemStatus } from "@/types";
import { usePlanningStore } from "@/lib/planning-store";
import { CollapsedColumn } from "./CollapsedColumn";
import { TaskLinkPicker } from "./TaskLinkPicker";
import { TaskDetailDrawer } from "./TaskDetailDrawer";

// P3: списочная колонка задач. Источник правды — M:N initiative ↔ item.
// «Создание задачи с нуля» убрано. Открытие задачи — в drawer.

type StatusFilter = "all" | "open" | "done";
type SortMode = "created" | "status" | "estimate";
type GroupMode = "none" | "status" | "category";

const STATUS_LABEL: Record<ItemStatus, string> = {
  inbox: "Inbox",
  todo: "В очереди",
  in_progress: "В работе",
  review: "Ревью",
  done: "Сделана",
  archived: "В архиве",
};

const STATUS_ORDER: Record<ItemStatus, number> = {
  inbox: 0,
  todo: 1,
  in_progress: 2,
  review: 3,
  done: 4,
  archived: 5,
};

const CATEGORY_LABEL: Record<string, string> = {
  development: "Разработка",
  sales: "Sales",
  account: "Account",
  support: "Поддержка",
  legal: "Legal",
};

export function TaskColumn() {
  const metricId = usePlanningStore((s) => s.selectedMetricId);
  const initiativeId = usePlanningStore((s) => s.selectedInitiativeId);
  const collapsed = usePlanningStore((s) => s.collapsedColumns.includes("tasks"));
  const toggleCollapse = usePlanningStore((s) => s.toggleColumnCollapsed);
  const allTasks = usePlanningStore((s) => s.tasks);
  const linkedIds = usePlanningStore((s) => (initiativeId ? s.initiativeItemIds[initiativeId] : undefined));
  const fetchInitiativeItems = usePlanningStore((s) => s.fetchInitiativeItems);

  const [filter, setFilter] = useState<StatusFilter>("open");
  const [sort, setSort] = useState<SortMode>("status");
  const [group, setGroup] = useState<GroupMode>("none");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (initiativeId) void fetchInitiativeItems(initiativeId);
  }, [initiativeId, fetchInitiativeItems]);

  const linkedSet = useMemo(() => new Set(linkedIds ?? []), [linkedIds]);
  const detailTask = useMemo(
    () => (detailTaskId ? allTasks.find((t) => t.id === detailTaskId) ?? null : null),
    [detailTaskId, allTasks]
  );

  // Items для отображения: всё что в linkedSet (parent + subtasks pre-included на backend).
  const visibleTasks: Item[] = useMemo(() => {
    if (!initiativeId) return [];
    const list = allTasks.filter((t) => linkedSet.has(t.id));
    return list.filter((t) => {
      if (filter === "open") return t.status !== "done" && t.status !== "archived";
      if (filter === "done") return t.status === "done";
      return t.status !== "archived";
    });
  }, [allTasks, linkedSet, filter, initiativeId]);

  const sorted: Item[] = useMemo(() => {
    const arr = [...visibleTasks];
    if (sort === "status") {
      arr.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    } else if (sort === "estimate") {
      arr.sort((a, b) => (b.estimated_minutes ?? 0) - (a.estimated_minutes ?? 0));
    } else {
      arr.sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
    }
    return arr;
  }, [visibleTasks, sort]);

  const groups = useMemo(() => {
    if (group === "none") return [{ key: "all", label: "", items: sorted }];
    const map = new Map<string, Item[]>();
    for (const t of sorted) {
      const key = group === "status" ? t.status : (t.category ?? "—");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      label: group === "status" ? STATUS_LABEL[key as ItemStatus] ?? key : (CATEGORY_LABEL[key] ?? key),
      items,
    }));
  }, [sorted, group]);

  const doneCount = visibleTasks.filter((t) => t.status === "done").length;
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

  const tabBase = "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors";
  const tabActive = "bg-slate-900 text-white";
  const tabInactive = "text-slate-500 hover:bg-slate-100";

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

      {/* Controls row 1: filter */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-1.5">
        <div role="tablist" aria-label="Фильтр" className="flex items-center gap-1">
          {(["all", "open", "done"] as StatusFilter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`${tabBase} ${filter === f ? tabActive : tabInactive}`}
            >
              {f === "all" ? "Все" : f === "open" ? "Открытые" : "Сделано"}
            </button>
          ))}
        </div>
        <span className="text-[10px] tabular-nums text-slate-400" title="Готовых / всего в фильтре">
          {doneCount} / {visibleTasks.length}
        </span>
      </div>

      {/* Controls row 2: sort + group */}
      <div className="flex items-center gap-3 border-b border-slate-100 bg-white px-3 py-1.5 text-[11px]">
        <label className="flex items-center gap-1 text-slate-500">
          Сорт:
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px]"
          >
            <option value="status">по статусу</option>
            <option value="created">новые сверху</option>
            <option value="estimate">по оценке</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-500">
          Группа:
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value as GroupMode)}
            className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px]"
          >
            <option value="none">нет</option>
            <option value="status">статус</option>
            <option value="category">категория</option>
          </select>
        </label>
      </div>

      {/* Body — table-like rows */}
      <div className="flex-1 overflow-y-auto">
        {totalLinked === 0 ? (
          <EmptyState onLink={() => setPickerOpen(true)} />
        ) : sorted.length === 0 ? (
          <p className="mt-8 text-center text-sm text-slate-500">Под фильтр ничего не попало.</p>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-50/95 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                <th className="w-6 px-2 py-1.5"></th>
                <th className="px-2 py-1.5 text-left">Title / Why</th>
                <th className="w-24 px-2 py-1.5 text-left">Статус</th>
                <th className="w-16 px-2 py-1.5 text-right">Est</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupBlock
                  key={g.key}
                  label={g.label}
                  items={g.items}
                  onOpen={setDetailTaskId}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pickerOpen && (
        <TaskLinkPicker
          initiativeId={initiativeId}
          excludeIds={linkedSet}
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <TaskDetailDrawer task={detailTask} onClose={() => setDetailTaskId(null)} />
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

function GroupBlock({
  label,
  items,
  onOpen,
}: {
  label: string;
  items: Item[];
  onOpen: (id: string) => void;
}) {
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const t of items) {
      if (!t.parent_id) continue;
      if (!map.has(t.parent_id)) map.set(t.parent_id, []);
      map.get(t.parent_id)!.push(t);
    }
    return map;
  }, [items]);

  // Top-level items (без parent) показываем, остальные — как nested.
  const topLevel = items.filter((t) => !t.parent_id || !items.some((x) => x.id === t.parent_id));

  return (
    <>
      {label && (
        <tr>
          <td colSpan={4} className="border-b border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {label} · {items.length}
          </td>
        </tr>
      )}
      {topLevel.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          subtasks={childrenByParent.get(t.id) ?? []}
          onOpen={onOpen}
        />
      ))}
    </>
  );
}

function TaskRow({
  task,
  subtasks,
  onOpen,
}: {
  task: Item;
  subtasks: Item[];
  onOpen: (id: string) => void;
}) {
  const updateTask = usePlanningStore((s) => s.updateTask);
  const [expanded, setExpanded] = useState(true);
  const isDone = task.status === "done";
  const isSubtask = !!task.parent_id;
  const estHours = task.estimated_minutes != null
    ? (task.estimated_minutes / 60).toFixed(1).replace(".0", "")
    : null;

  return (
    <>
      <tr
        onClick={() => onOpen(task.id)}
        className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${isDone ? "opacity-60" : ""}`}
      >
        <td className="px-2 py-1.5 align-top" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            {subtasks.length > 0 && !isSubtask ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100"
                title={expanded ? "Свернуть подзадачи" : "Развернуть подзадачи"}
              >
                <ChevronRight className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>
            ) : (
              <span className="inline-block w-4" />
            )}
            <input
              type="checkbox"
              checked={isDone}
              onChange={(e) => updateTask(task.id, { status: e.target.checked ? "done" : "todo" })}
              className="size-3.5 cursor-pointer rounded border-slate-300"
            />
          </div>
        </td>
        <td className="px-2 py-1.5 align-top">
          <div className={`text-sm ${isDone ? "text-slate-400 line-through" : ""} ${isSubtask ? "pl-4 text-[13px]" : "font-medium"}`}>
            {task.title}
          </div>
          {task.why && (
            <div className="truncate text-xs italic text-slate-500" title={task.why}>
              {task.why}
            </div>
          )}
        </td>
        <td className="px-2 py-1.5 align-top">
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
            {STATUS_LABEL[task.status]}
          </span>
        </td>
        <td className="px-2 py-1.5 text-right align-top text-[11px] tabular-nums text-slate-500">
          {estHours ? `${estHours}ч` : ""}
        </td>
      </tr>
      {expanded && subtasks.map((sub) => (
        <TaskRow key={sub.id} task={sub} subtasks={[]} onOpen={onOpen} />
      ))}
    </>
  );
}
