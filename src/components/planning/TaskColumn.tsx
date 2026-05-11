"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2, ChevronsLeft, ChevronRight, Search, Columns3, ChevronUp, ChevronDown } from "lucide-react";
import type { Item, ItemPriority, ItemStatus } from "@/types";
import { usePlanningStore } from "@/lib/planning-store";
import { CollapsedColumn } from "./CollapsedColumn";
import { TaskLinkPicker } from "./TaskLinkPicker";
import { TaskDetailDrawer } from "./TaskDetailDrawer";

// P3+P7: списочная колонка задач. Источник правды — M:N initiative ↔ item.
// «Создание задачи с нуля» убрано. Открытие задачи — в drawer.
// P7.5: расширенный фильтр (text search + category multi-select + due sort).
// P7.6: hide/reorder колонок таблицы через popover, persistence в localStorage.

type StatusFilter = "all" | "open" | "done";
type SortMode = "created" | "status" | "estimate" | "due_asc" | "due_desc" | "priority";
type GroupMode = "none" | "status" | "category" | "priority";

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

const PRIORITY_LABEL: Record<ItemPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "—",
};

const PRIORITY_ORDER: Record<ItemPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

// P7.6: конфигурация колонок таблицы. visible + order сохраняются в localStorage.
type ColumnKey = "title" | "status" | "category" | "priority" | "due" | "estimate";
interface ColumnConfig { key: ColumnKey; label: string; visible: boolean }
const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: "title",    label: "Title / Why", visible: true  },
  { key: "status",   label: "Статус",      visible: true  },
  { key: "category", label: "Категория",   visible: false },
  { key: "priority", label: "Приоритет",   visible: false },
  { key: "due",      label: "Срок",        visible: false },
  { key: "estimate", label: "Est",         visible: true  },
];
const COLUMNS_LS_KEY = "planning.taskColumn.cols.v1";

function loadColumns(): ColumnConfig[] {
  if (typeof window === "undefined") return DEFAULT_COLUMNS;
  try {
    const raw = localStorage.getItem(COLUMNS_LS_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    const parsed = JSON.parse(raw) as ColumnConfig[];
    // Merge с дефолтом — если в LS старая версия без некоторых колонок, добавляем.
    const known = new Set(parsed.map((c) => c.key));
    const merged = [...parsed];
    for (const def of DEFAULT_COLUMNS) {
      if (!known.has(def.key)) merged.push(def);
    }
    return merged.filter((c) => DEFAULT_COLUMNS.some((d) => d.key === c.key));
  } catch {
    return DEFAULT_COLUMNS;
  }
}

function saveColumns(cols: ColumnConfig[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(COLUMNS_LS_KEY, JSON.stringify(cols)); } catch { /* quota */ }
}

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
  const [query, setQuery] = useState("");
  const [categorySel, setCategorySel] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [columnsPopoverOpen, setColumnsPopoverOpen] = useState(false);

  // P7.6: гидратация колонок из LS на клиенте (SSR safe).
  useEffect(() => { setColumns(loadColumns()); }, []);

  // Debounce search query (200ms).
  const [queryDebounced, setQueryDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQueryDebounced(query.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (initiativeId) void fetchInitiativeItems(initiativeId);
  }, [initiativeId, fetchInitiativeItems]);

  const linkedSet = useMemo(() => new Set(linkedIds ?? []), [linkedIds]);
  const detailTask = useMemo(
    () => (detailTaskId ? allTasks.find((t) => t.id === detailTaskId) ?? null : null),
    [detailTaskId, allTasks]
  );

  // Список доступных категорий — из реальных tasks (для UX чистоты).
  const availableCategories = useMemo(() => {
    const s = new Set<string>();
    for (const t of allTasks) if (linkedSet.has(t.id) && t.category) s.add(t.category);
    return Array.from(s).sort();
  }, [allTasks, linkedSet]);

  // Items для отображения: всё что в linkedSet (parent + subtasks pre-included на backend).
  const visibleTasks: Item[] = useMemo(() => {
    if (!initiativeId) return [];
    const list = allTasks.filter((t) => linkedSet.has(t.id));
    return list.filter((t) => {
      // Status filter
      if (filter === "open" && (t.status === "done" || t.status === "archived")) return false;
      if (filter === "done" && t.status !== "done") return false;
      if (filter === "all" && t.status === "archived") return false;
      // Category multi-select
      if (categorySel.size > 0 && (!t.category || !categorySel.has(t.category))) return false;
      // Text search
      if (queryDebounced) {
        const hay = `${t.title} ${t.why ?? ""}`.toLowerCase();
        if (!hay.includes(queryDebounced)) return false;
      }
      return true;
    });
  }, [allTasks, linkedSet, filter, initiativeId, categorySel, queryDebounced]);

  const sorted: Item[] = useMemo(() => {
    const arr = [...visibleTasks];
    const dueOf = (t: Item): number => {
      const d = t.due_date ?? t.planned_date ?? null;
      return d ? new Date(d).getTime() : Infinity;
    };
    switch (sort) {
      case "status":   arr.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]); break;
      case "estimate": arr.sort((a, b) => (b.estimated_minutes ?? 0) - (a.estimated_minutes ?? 0)); break;
      case "due_asc":  arr.sort((a, b) => dueOf(a) - dueOf(b)); break;
      case "due_desc": arr.sort((a, b) => dueOf(b) - dueOf(a)); break;
      case "priority": arr.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]); break;
      case "created":  arr.sort((a, b) => (a.created_at > b.created_at ? -1 : 1)); break;
    }
    return arr;
  }, [visibleTasks, sort]);

  const groups = useMemo(() => {
    if (group === "none") return [{ key: "all", label: "", items: sorted }];
    const map = new Map<string, Item[]>();
    for (const t of sorted) {
      let key: string;
      if (group === "status") key = t.status;
      else if (group === "priority") key = t.priority;
      else key = t.category ?? "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      label: group === "status" ? STATUS_LABEL[key as ItemStatus] ?? key
        : group === "priority" ? PRIORITY_LABEL[key as ItemPriority] ?? key
        : (CATEGORY_LABEL[key] ?? key),
      items,
    }));
  }, [sorted, group]);

  const doneCount = visibleTasks.filter((t) => t.status === "done").length;
  const totalLinked = linkedSet.size;

  const visibleCols = useMemo(() => columns.filter((c) => c.visible), [columns]);

  const setColumnVisible = (key: ColumnKey, visible: boolean) => {
    setColumns((prev) => {
      const next = prev.map((c) => c.key === key ? { ...c, visible } : c);
      saveColumns(next);
      return next;
    });
  };
  const moveColumn = (key: ColumnKey, dir: -1 | 1) => {
    setColumns((prev) => {
      const idx = prev.findIndex((c) => c.key === key);
      const target = idx + dir;
      if (idx === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      saveColumns(next);
      return next;
    });
  };
  const toggleCategory = (cat: string) => {
    setCategorySel((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

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
          <div className="relative">
            <button
              onClick={() => setColumnsPopoverOpen((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                columnsPopoverOpen ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              title="Скрыть/показать/переставить колонки"
            >
              <Columns3 className="size-3.5" /> Колонки
            </button>
            {columnsPopoverOpen && (
              <ColumnsPopover
                columns={columns}
                onToggle={setColumnVisible}
                onMove={moveColumn}
                onClose={() => setColumnsPopoverOpen(false)}
              />
            )}
          </div>
          <button
            onClick={() => toggleCollapse("tasks")}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Свернуть колонку"
          >
            <ChevronsLeft className="size-4" />
          </button>
        </div>
      </div>

      {/* Search row */}
      <div className="flex items-center gap-2 border-b border-slate-100 bg-white px-3 py-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по title и why…"
            className="w-full rounded-md border border-slate-200 bg-white py-1 pl-7 pr-2 text-[12px] focus:border-blue-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Controls row 1: status filter */}
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

      {/* Controls row 2: sort + group + category */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-white px-3 py-1.5 text-[11px]">
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
            <option value="due_asc">срок ↑</option>
            <option value="due_desc">срок ↓</option>
            <option value="priority">по приоритету</option>
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
            <option value="priority">приоритет</option>
          </select>
        </label>
        {availableCategories.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Кат.:</span>
            {availableCategories.map((cat) => {
              const active = categorySel.has(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                    active
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                  title={active ? "Убрать фильтр" : "Только эта категория"}
                >
                  {CATEGORY_LABEL[cat] ?? cat}
                </button>
              );
            })}
            {categorySel.size > 0 && (
              <button
                type="button"
                onClick={() => setCategorySel(new Set())}
                className="text-[10px] uppercase text-slate-400 hover:text-slate-600"
              >
                сброс
              </button>
            )}
          </div>
        )}
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
                {visibleCols.map((c) => (
                  <th
                    key={c.key}
                    className={`px-2 py-1.5 ${
                      c.key === "estimate" ? "w-16 text-right" : c.key === "status" || c.key === "priority" ? "w-24 text-left" : c.key === "category" ? "w-28 text-left" : c.key === "due" ? "w-24 text-left" : "text-left"
                    }`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupBlock
                  key={g.key}
                  label={g.label}
                  items={g.items}
                  onOpen={setDetailTaskId}
                  visibleCols={visibleCols}
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

function ColumnsPopover({
  columns,
  onToggle,
  onMove,
  onClose,
}: {
  columns: ColumnConfig[];
  onToggle: (key: ColumnKey, v: boolean) => void;
  onMove: (key: ColumnKey, dir: -1 | 1) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">Колонки таблицы</p>
        <ul className="flex flex-col gap-0.5">
          {columns.map((c, idx) => (
            <li key={c.key} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={c.visible}
                onChange={(e) => onToggle(c.key, e.target.checked)}
                className="size-3.5 cursor-pointer rounded border-slate-300"
              />
              <span className="flex-1 truncate text-[12px] text-slate-700">{c.label}</span>
              <button
                type="button"
                onClick={() => onMove(c.key, -1)}
                disabled={idx === 0}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                title="Выше"
              >
                <ChevronUp className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => onMove(c.key, 1)}
                disabled={idx === columns.length - 1}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                title="Ниже"
              >
                <ChevronDown className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
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
  visibleCols,
}: {
  label: string;
  items: Item[];
  onOpen: (id: string) => void;
  visibleCols: ColumnConfig[];
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
  const colSpan = visibleCols.length + 1;

  return (
    <>
      {label && (
        <tr>
          <td colSpan={colSpan} className="border-b border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
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
          visibleCols={visibleCols}
        />
      ))}
    </>
  );
}

function TaskRow({
  task,
  subtasks,
  onOpen,
  visibleCols,
}: {
  task: Item;
  subtasks: Item[];
  onOpen: (id: string) => void;
  visibleCols: ColumnConfig[];
}) {
  const updateTask = usePlanningStore((s) => s.updateTask);
  const [expanded, setExpanded] = useState(true);
  const isDone = task.status === "done";
  const isSubtask = !!task.parent_id;
  const estHours = task.estimated_minutes != null
    ? (task.estimated_minutes / 60).toFixed(1).replace(".0", "")
    : null;

  const renderCell = (c: ColumnConfig) => {
    switch (c.key) {
      case "title":
        return (
          <td key={c.key} className="px-2 py-1.5 align-top">
            <div className={`text-sm ${isDone ? "text-slate-400 line-through" : ""} ${isSubtask ? "pl-4 text-[13px]" : "font-medium"}`}>
              {task.title}
            </div>
            {task.why && (
              <div className="truncate text-xs italic text-slate-500" title={task.why}>
                {task.why}
              </div>
            )}
          </td>
        );
      case "status":
        return (
          <td key={c.key} className="px-2 py-1.5 align-top">
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
              {STATUS_LABEL[task.status]}
            </span>
          </td>
        );
      case "category":
        return (
          <td key={c.key} className="px-2 py-1.5 align-top text-[11px] text-slate-600">
            {task.category ? (CATEGORY_LABEL[task.category] ?? task.category) : "—"}
          </td>
        );
      case "priority":
        return (
          <td key={c.key} className="px-2 py-1.5 align-top">
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
              task.priority === "urgent" ? "bg-red-50 text-red-700"
              : task.priority === "high" ? "bg-amber-50 text-amber-700"
              : task.priority === "low" ? "bg-slate-50 text-slate-500"
              : task.priority === "none" ? "bg-slate-50 text-slate-400"
              : "bg-slate-100 text-slate-600"
            }`}>
              {PRIORITY_LABEL[task.priority]}
            </span>
          </td>
        );
      case "due": {
        const due = task.due_date ?? task.planned_date ?? null;
        return (
          <td key={c.key} className="px-2 py-1.5 align-top text-[11px] tabular-nums text-slate-500">
            {due ? due.slice(0, 10) : "—"}
          </td>
        );
      }
      case "estimate":
        return (
          <td key={c.key} className="px-2 py-1.5 text-right align-top text-[11px] tabular-nums text-slate-500">
            {estHours ? `${estHours}ч` : ""}
          </td>
        );
    }
  };

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
        {visibleCols.map(renderCell)}
      </tr>
      {expanded && subtasks.map((sub) => (
        <TaskRow key={sub.id} task={sub} subtasks={[]} onOpen={onOpen} visibleCols={visibleCols} />
      ))}
    </>
  );
}
