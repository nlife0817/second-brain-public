"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, ChevronRight, ChevronDown, Columns3, ChevronUp, ChevronDown as ChevronDownArrow } from "lucide-react";
import { useBrainStore } from "@/lib/store";
import { STATUS_CONFIG, PRIORITY_CONFIG } from "@/types";
import type { Item, ItemStatus, ItemPriority, ItemWithSubtasks } from "@/types";
import { cn } from "@/lib/utils";

// Изолированный «Задачи»-вид: фильтры/группировка/сортировка/колонки — локальный
// state. Не делит ничего с основным разделом «Задачи» (useFilteredItems/list*
// настройки store) — то есть изменения здесь не утекают в основной раздел.
//
// Используется и в правой колонке Planning (Задачи инициативы), и в модалке
// «Привязать» (с selectionMode).

type StatusFilter = "all" | "open" | "done";
type SortMode = "created" | "status" | "estimate" | "due_asc" | "due_desc" | "priority";
type GroupMode = "none" | "status" | "category" | "priority";
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

const STATUS_LABEL: Record<ItemStatus, string> = {
  inbox: "Inbox",
  todo: "В очереди",
  in_progress: "В работе",
  review: "Ревью",
  done: "Сделана",
  archived: "В архиве",
};

const STATUS_ORDER: Record<ItemStatus, number> = {
  inbox: 0, todo: 1, in_progress: 2, review: 3, done: 4, archived: 5,
};

const CATEGORY_LABEL: Record<string, string> = {
  development: "Разработка",
  sales: "Sales",
  account: "Account",
  support: "Поддержка",
  legal: "Legal",
};

const PRIORITY_LABEL: Record<ItemPriority, string> = {
  urgent: "Urgent", high: "High", medium: "Medium", low: "Low", none: "—",
};

const PRIORITY_ORDER: Record<ItemPriority, number> = {
  urgent: 0, high: 1, medium: 2, low: 3, none: 4,
};

interface Props {
  /** Источник задач. Если не задан — берём из useBrainStore.items (плоский). */
  items?: Item[];
  /** Фильтр предикатом до отображения (например, оставить только linked к инициативе). */
  itemFilter?: (t: Item) => boolean;
  /** Идентификаторы для исключения (например, уже привязанные). */
  excludeIds?: Set<string>;
  /** Если задано — режим выбора. Клик по строке = toggle, отображается чекбокс. */
  selectionMode?: {
    selected: Set<string>;
    onToggle: (id: string) => void;
  };
  /** Колбэк открытия задачи (когда selectionMode не задан). Default — useBrainStore.openDetail. */
  onOpenTask?: (id: string) => void;
  /** Ключ для localStorage сохранения настроек колонок. */
  storageKey?: string;
  /** Класс контейнера. */
  className?: string;
  /** Размер: compact — для узкой колонки, regular — для модалки. */
  density?: "compact" | "regular";
  /** Не показывать панель колонок-поповера (для совсем узкого UI). */
  hideColumnsButton?: boolean;
}

function loadColumns(storageKey: string | undefined): ColumnConfig[] {
  if (typeof window === "undefined" || !storageKey) return DEFAULT_COLUMNS;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return DEFAULT_COLUMNS;
    const parsed = JSON.parse(raw) as ColumnConfig[];
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

function saveColumns(storageKey: string | undefined, cols: ColumnConfig[]) {
  if (typeof window === "undefined" || !storageKey) return;
  try { localStorage.setItem(storageKey, JSON.stringify(cols)); } catch { /* quota */ }
}

export function TaskSelectionList({
  items: itemsProp,
  itemFilter,
  excludeIds,
  selectionMode,
  onOpenTask,
  storageKey,
  className,
  density = "regular",
  hideColumnsButton = false,
}: Props) {
  const brainItems = useBrainStore((s) => s.items);
  const openDetailStore = useBrainStore((s) => s.openDetail);

  // Источник: если items переданы — используем их, иначе плоский список из brainItems.
  const sourceItems: Item[] = useMemo(() => {
    if (itemsProp) return itemsProp;
    const flat: Item[] = [];
    for (const top of brainItems) {
      flat.push(top);
      for (const sub of top.subtasks ?? []) flat.push(sub);
    }
    return flat;
  }, [itemsProp, brainItems]);

  // ---- Локальный state (НЕ синхронизируется с useBrainStore) ---------------
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [sort, setSort] = useState<SortMode>("status");
  const [group, setGroup] = useState<GroupMode>("none");
  const [query, setQuery] = useState("");
  const [queryDebounced, setQueryDebounced] = useState("");
  const [categorySel, setCategorySel] = useState<Set<string>>(new Set());
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [columnsPopoverOpen, setColumnsPopoverOpen] = useState(false);

  useEffect(() => { setColumns(loadColumns(storageKey)); }, [storageKey]);

  useEffect(() => {
    const t = setTimeout(() => setQueryDebounced(query.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const onOpenResolved = onOpenTask ?? openDetailStore;

  // ---- Фильтр + сортировка + группировка -----------------------------------
  const visibleTasks: Item[] = useMemo(() => {
    return sourceItems.filter((t) => {
      if (excludeIds?.has(t.id)) return false;
      if (itemFilter && !itemFilter(t)) return false;
      if (t.type !== undefined && t.type !== "task" && t.type !== "meeting" && t.type !== "plan") return false;
      if (filter === "open" && (t.status === "done" || t.status === "archived")) return false;
      if (filter === "done" && t.status !== "done") return false;
      if (filter === "all" && t.status === "archived") return false;
      if (categorySel.size > 0 && (!t.category || !categorySel.has(t.category))) return false;
      if (queryDebounced) {
        const hay = `${t.title} ${t.why ?? ""}`.toLowerCase();
        if (!hay.includes(queryDebounced)) return false;
      }
      return true;
    });
  }, [sourceItems, excludeIds, itemFilter, filter, categorySel, queryDebounced]);

  const availableCategories = useMemo(() => {
    const s = new Set<string>();
    for (const t of visibleTasks) if (t.category) s.add(t.category);
    return Array.from(s).sort();
  }, [visibleTasks]);

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

  const visibleCols = useMemo(() => columns.filter((c) => c.visible), [columns]);
  const setColumnVisible = (key: ColumnKey, visible: boolean) => {
    setColumns((prev) => {
      const next = prev.map((c) => c.key === key ? { ...c, visible } : c);
      saveColumns(storageKey, next);
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
      saveColumns(storageKey, next);
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

  const doneCount = visibleTasks.filter((t) => t.status === "done").length;

  // ---- UI ------------------------------------------------------------------
  const tabBase = "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors";
  const tabActive = "bg-slate-900 text-white";
  const tabInactive = "text-slate-500 hover:bg-slate-100";

  return (
    <div className={cn("flex h-full flex-col", className)}>
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
        {!hideColumnsButton && (
          <div className="relative">
            <button
              onClick={() => setColumnsPopoverOpen((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                columnsPopoverOpen
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              )}
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
        )}
      </div>

      {/* Status filter */}
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

      {/* Sort + group + category */}
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
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                    active
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  )}
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <p className="mt-8 text-center text-sm text-slate-500">
            {visibleTasks.length === 0 && queryDebounced ? "Ничего не найдено." : "Под фильтр ничего не попало."}
          </p>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                <th className="w-6 px-2 py-1.5"></th>
                {visibleCols.map((c) => (
                  <th
                    key={c.key}
                    className={cn(
                      "px-2 py-1.5",
                      c.key === "estimate" && "w-16 text-right",
                      (c.key === "status" || c.key === "priority") && "w-24 text-left",
                      c.key === "category" && "w-28 text-left",
                      c.key === "due" && "w-24 text-left",
                      c.key === "title" && "text-left"
                    )}
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
                  onOpen={onOpenResolved}
                  selectionMode={selectionMode}
                  visibleCols={visibleCols}
                  density={density}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function GroupBlock({
  label,
  items,
  onOpen,
  selectionMode,
  visibleCols,
  density,
}: {
  label: string;
  items: Item[];
  onOpen: (id: string) => void;
  selectionMode?: Props["selectionMode"];
  visibleCols: ColumnConfig[];
  density: "compact" | "regular";
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
          selectionMode={selectionMode}
          visibleCols={visibleCols}
          density={density}
        />
      ))}
    </>
  );
}

function TaskRow({
  task,
  subtasks,
  onOpen,
  selectionMode,
  visibleCols,
  density,
}: {
  task: Item;
  subtasks: Item[];
  onOpen: (id: string) => void;
  selectionMode?: Props["selectionMode"];
  visibleCols: ColumnConfig[];
  density: "compact" | "regular";
}) {
  const [expanded, setExpanded] = useState(true);
  const isDone = task.status === "done";
  const isSubtask = !!task.parent_id;
  const estHours = task.estimated_minutes != null
    ? (task.estimated_minutes / 60).toFixed(1).replace(".0", "")
    : null;
  const isSelected = !!selectionMode?.selected.has(task.id);
  const rowPad = density === "compact" ? "py-1" : "py-1.5";

  const handleClick = () => {
    if (selectionMode) selectionMode.onToggle(task.id);
    else onOpen(task.id);
  };

  const renderCell = (c: ColumnConfig) => {
    switch (c.key) {
      case "title":
        return (
          <td key={c.key} className={cn("px-2 align-top", rowPad)}>
            <div className={cn(
              "text-sm",
              isDone && "text-slate-400 line-through",
              isSubtask ? "pl-4 text-[13px]" : "font-medium"
            )}>
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
          <td key={c.key} className={cn("px-2 align-top", rowPad)}>
            <span className={cn(
              "rounded-md px-1.5 py-0.5 text-[10px]",
              STATUS_CONFIG[task.status]?.color ?? "bg-slate-100 text-slate-600"
            )}>
              {STATUS_LABEL[task.status]}
            </span>
          </td>
        );
      case "category":
        return (
          <td key={c.key} className={cn("px-2 align-top text-[11px] text-slate-600", rowPad)}>
            {task.category ? (CATEGORY_LABEL[task.category] ?? task.category) : "—"}
          </td>
        );
      case "priority":
        return (
          <td key={c.key} className={cn("px-2 align-top", rowPad)}>
            <span className={cn(
              "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
              task.priority === "urgent" && "bg-red-50 text-red-700",
              task.priority === "high" && "bg-amber-50 text-amber-700",
              task.priority === "medium" && "bg-slate-100 text-slate-600",
              task.priority === "low" && "bg-slate-50 text-slate-500",
              task.priority === "none" && "bg-slate-50 text-slate-400"
            )}>
              {PRIORITY_LABEL[task.priority]}
            </span>
          </td>
        );
      case "due": {
        const due = task.due_date ?? task.planned_date ?? null;
        return (
          <td key={c.key} className={cn("px-2 align-top text-[11px] tabular-nums text-slate-500", rowPad)}>
            {due ? due.slice(0, 10) : "—"}
          </td>
        );
      }
      case "estimate":
        return (
          <td key={c.key} className={cn("px-2 text-right align-top text-[11px] tabular-nums text-slate-500", rowPad)}>
            {estHours ? `${estHours}ч` : ""}
          </td>
        );
    }
  };

  return (
    <>
      <tr
        onClick={handleClick}
        className={cn(
          "cursor-pointer border-b border-slate-100 hover:bg-slate-50",
          isDone && "opacity-60",
          isSelected && "bg-blue-50 hover:bg-blue-100/60"
        )}
      >
        <td className={cn("px-2 align-top", rowPad)} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            {subtasks.length > 0 && !isSubtask ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100"
                title={expanded ? "Свернуть подзадачи" : "Развернуть подзадачи"}
              >
                {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              </button>
            ) : (
              <span className="inline-block w-4" />
            )}
            {selectionMode ? (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => selectionMode.onToggle(task.id)}
                className="size-3.5 cursor-pointer rounded border-slate-300"
              />
            ) : (
              <span className="inline-block w-3.5" />
            )}
          </div>
        </td>
        {visibleCols.map(renderCell)}
      </tr>
      {expanded && subtasks.map((sub) => (
        <TaskRow
          key={sub.id}
          task={sub}
          subtasks={[]}
          onOpen={onOpen}
          selectionMode={selectionMode}
          visibleCols={visibleCols}
          density={density}
        />
      ))}
    </>
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
                <ChevronDownArrow className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// Unused, but keep import surface stable.
export type { ItemWithSubtasks };
