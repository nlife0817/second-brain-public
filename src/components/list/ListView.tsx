"use client";

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import { useFilteredItems, useBrainStore, useCategoryConfig } from "@/lib/store";
import {
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  TYPE_CONFIG,
  ItemWithSubtasks,
  ItemStatus,
  ItemPriority,
  ItemCategory,
  ItemType,
  Item,
  ListGroupByField,
  ListGroupByConfig,
} from "@/types";
import { format, isPast, isToday, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Calendar,
  AlertCircle,
  Inbox,
  ChevronRight,
  ChevronDown,
  GripVertical,
  Settings2,
  ChevronUp as MoveUpIcon,
  ChevronDown as MoveDownIcon,
  RotateCcw,
  Eye,
  EyeOff,
  Plus,
  Check,
  X,
  Layers,
  Trash2,
  Archive,
  Link,
  MessageSquare,
  ChevronsUpDown,
  ExternalLink as ExternalLinkIcon,
  Sparkles as SparklesIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

function SourceIcon({ source }: { source: string }) {
  if (source === "kaiten") return <span title="Kaiten"><ExternalLinkIcon className="size-3 text-slate-300 shrink-0 mr-0.5" /></span>;
  if (source === "claude") return <span title="Claude"><SparklesIcon className="size-3 text-slate-300 shrink-0 mr-0.5" /></span>;
  return null;
}
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

import {
  DndContext,
  DragEndEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type SortColumn =
  | "title"
  | "status"
  | "priority"
  | "category"
  | "type"
  | "due_date"
  | "created_at";

type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

/* -------------------------------------------------------------------------- */
/*  Column definitions                                                        */
/* -------------------------------------------------------------------------- */

interface ColumnDef {
  id: string;
  label: string;
  width: string;
  sortable: boolean;
}

const ALL_COLUMNS: ColumnDef[] = [
  { id: "priority", label: "Приоритет", width: "w-20", sortable: true },
  { id: "title", label: "Название", width: "min-w-[250px] flex-1", sortable: true },
  { id: "status", label: "Статус", width: "w-28", sortable: true },
  { id: "category", label: "Категория", width: "w-28", sortable: true },
  { id: "type", label: "Тип", width: "w-24", sortable: true },
  { id: "due_date", label: "Дедлайн", width: "w-24", sortable: true },
  { id: "subtasks", label: "Подзадачи", width: "w-20", sortable: false },
];

const DEFAULT_COLUMN_ORDER = [
  "priority",
  "title",
  "status",
  "category",
  "type",
  "due_date",
  "subtasks",
];

/* -------------------------------------------------------------------------- */
/*  Priority / status sort weight (lower = more urgent)                       */
/* -------------------------------------------------------------------------- */

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

const STATUS_WEIGHT: Record<string, number> = {
  in_progress: 0,
  review: 1,
  todo: 2,
  inbox: 3,
  done: 4,
  archived: 5,
};

/* -------------------------------------------------------------------------- */
/*  Helper: build flat row list (always accordion mode)                       */
/* -------------------------------------------------------------------------- */

interface FlatRow {
  item: ItemWithSubtasks | Item;
  isSubtask: boolean;
  parentId: string | null;
  depth: number;
  hasSubtasks: boolean;
  totalSubtasks: number;
  doneSubtasks: number;
}

function buildFlatRows(
  sortedItems: ItemWithSubtasks[],
  expandedItems: Set<string>
): FlatRow[] {
  const rows: FlatRow[] = [];

  for (const item of sortedItems) {
    // Items with parent_id are subtasks shown as detached — no nesting allowed
    const isDetachedSubtask = !!item.parent_id;
    const totalSub = isDetachedSubtask ? 0 : (item.subtasks?.length ?? 0);
    const doneSub = isDetachedSubtask ? 0 :
      (item.subtasks?.filter((s) => s.status === "done").length ?? 0);

    rows.push({
      item,
      isSubtask: false,
      parentId: null,
      depth: 0,
      hasSubtasks: totalSub > 0,
      totalSubtasks: totalSub,
      doneSubtasks: doneSub,
    });

    if (totalSub > 0 && expandedItems.has(item.id)) {
      for (const sub of item.subtasks) {
        rows.push({
          item: sub,
          isSubtask: true,
          parentId: item.id,
          depth: 1,
          hasSubtasks: false,
          totalSubtasks: 0,
          doneSubtasks: 0,
        });
      }
    }
  }

  return rows;
}

/* -------------------------------------------------------------------------- */
/*  Grouping helpers                                                          */
/* -------------------------------------------------------------------------- */

const GROUP_BY_OPTIONS: { key: ListGroupByField; label: string }[] = [
  { key: "none", label: "Без группировки" },
  { key: "status", label: "Статус" },
  { key: "priority", label: "Приоритет" },
  { key: "category", label: "Категория" },
  { key: "type", label: "Тип" },
  { key: "development_stage", label: "Этап разработки" },
];

function getGroupKey(item: ItemWithSubtasks, field: ListGroupByField): string {
  switch (field) {
    case "status": return item.status;
    case "priority": return item.priority;
    case "category": return item.category;
    case "type": return item.type;
    case "development_stage": return item.development_stage ?? "__none__";
    default: return "";
  }
}

function getGroupLabel(field: ListGroupByField, key: string, categoryConfig: Record<string, { label: string; icon: string; color: string }>): string {
  switch (field) {
    case "status": return STATUS_CONFIG[key as ItemStatus]?.label ?? key;
    case "priority": return PRIORITY_CONFIG[key as ItemPriority]?.label ?? key;
    case "category": return categoryConfig[key]?.label ?? key;
    case "type": return TYPE_CONFIG[key as ItemType]?.label ?? key;
    case "development_stage": return key === "__none__" ? "Не указано" : key;
    default: return key;
  }
}

function getGroupIcon(field: ListGroupByField, key: string): string {
  switch (field) {
    case "priority": return PRIORITY_CONFIG[key as ItemPriority]?.icon ?? "";
    default: return "";
  }
}

const GROUP_ORDER: Record<string, Record<string, number>> = {
  status: STATUS_WEIGHT,
  priority: PRIORITY_WEIGHT,
};

interface ItemGroup {
  key: string;
  label: string;
  icon: string;
  items: ItemWithSubtasks[];
}

function groupItems(
  items: ItemWithSubtasks[],
  field: ListGroupByField,
  categoryConfig: Record<string, { label: string; icon: string; color: string }>
): ItemGroup[] {
  if (field === "none") return [];

  const map = new Map<string, ItemWithSubtasks[]>();
  for (const item of items) {
    const key = getGroupKey(item, field);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  const groups: ItemGroup[] = [];
  for (const [key, groupItems] of map) {
    groups.push({
      key,
      label: getGroupLabel(field, key, categoryConfig),
      icon: getGroupIcon(field, key),
      items: groupItems,
    });
  }

  // Sort groups by predefined order if available, otherwise alphabetically
  const orderMap = GROUP_ORDER[field];
  if (orderMap) {
    groups.sort((a, b) => (orderMap[a.key] ?? 99) - (orderMap[b.key] ?? 99));
  } else {
    groups.sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }

  return groups;
}

/* -------------------------------------------------------------------------- */
/*  GroupBy config popover (two levels)                                        */
/* -------------------------------------------------------------------------- */

function GroupByPopover({
  value,
  onChange,
}: {
  value: ListGroupByConfig;
  onChange: (config: ListGroupByConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const isActive = value[0] !== "none";
  const level2Options = GROUP_BY_OPTIONS.filter((o) => o.key === "none" || o.key !== value[0]);

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex items-center justify-center size-6 rounded hover:bg-slate-200/70 transition-colors",
          isActive
            ? "text-violet-500 hover:text-violet-700"
            : "text-slate-400 hover:text-slate-600"
        )}
        title="Группировка"
      >
        <Layers className="size-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
          {/* Level 1 */}
          <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider px-3 py-1.5">
            Уровень 1
          </div>
          {GROUP_BY_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                const newL1 = opt.key;
                const newL2 = newL1 === "none" ? "none" as ListGroupByField : (value[1] === newL1 ? "none" as ListGroupByField : value[1]);
                onChange([newL1, newL2]);
                if (newL1 === "none") setOpen(false);
              }}
              className={cn(
                "flex w-full items-center px-3 py-1.5 text-xs hover:bg-slate-50 text-left",
                opt.key === value[0] && "bg-violet-50 text-violet-700 font-medium"
              )}
            >
              {opt.label}
            </button>
          ))}

          {/* Level 2 — only if level 1 is set */}
          {value[0] !== "none" && (
            <>
              <div className="border-t border-slate-100 mt-1 mb-0.5" />
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider px-3 py-1.5">
                Уровень 2
              </div>
              {level2Options.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => {
                    onChange([value[0], opt.key]);
                    if (opt.key === "none") setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center px-3 py-1.5 text-xs hover:bg-slate-50 text-left",
                    opt.key === value[1] && "bg-violet-50 text-violet-700 font-medium"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Column config popover                                                     */
/* -------------------------------------------------------------------------- */

function ColumnConfigPopover({
  columnOrder,
  onOrderChange,
}: {
  columnOrder: string[];
  onOrderChange: (order: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const allColIds = ALL_COLUMNS.map((c) => c.id);
  const visibleSet = new Set(columnOrder);

  const toggleColumn = (colId: string) => {
    if (colId === "title") return;
    if (visibleSet.has(colId)) {
      onOrderChange(columnOrder.filter((c) => c !== colId));
    } else {
      onOrderChange([...columnOrder, colId]);
    }
  };

  const moveUp = (colId: string) => {
    const idx = columnOrder.indexOf(colId);
    if (idx <= 0) return;
    const next = [...columnOrder];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onOrderChange(next);
  };

  const moveDown = (colId: string) => {
    const idx = columnOrder.indexOf(colId);
    if (idx < 0 || idx >= columnOrder.length - 1) return;
    const next = [...columnOrder];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onOrderChange(next);
  };

  const reset = () => {
    onOrderChange([...DEFAULT_COLUMN_ORDER]);
  };

  const colMap = Object.fromEntries(ALL_COLUMNS.map((c) => [c.id, c]));

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center justify-center size-6 rounded hover:bg-slate-200/70 transition-colors text-slate-400 hover:text-slate-600"
        title="Настройка колонок"
      >
        <Settings2 className="size-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-slate-200 bg-white shadow-lg p-3">
          <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2">
            Колонки
          </div>

          <div className="space-y-0.5 mb-2">
            {columnOrder.map((colId, idx) => {
              const col = colMap[colId];
              if (!col) return null;
              const isTitle = colId === "title";
              return (
                <div
                  key={colId}
                  className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-slate-50 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => toggleColumn(colId)}
                    className={cn(
                      "shrink-0",
                      isTitle
                        ? "text-slate-300 cursor-not-allowed"
                        : "text-blue-500 hover:text-blue-700"
                    )}
                    disabled={isTitle}
                    title={isTitle ? "Нельзя скрыть" : "Скрыть"}
                  >
                    <Eye className="size-3" />
                  </button>
                  <span className="flex-1 text-slate-700 truncate">
                    {col.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => moveUp(colId)}
                    disabled={idx === 0}
                    className="text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <MoveUpIcon className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(colId)}
                    disabled={idx === columnOrder.length - 1}
                    className="text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <MoveDownIcon className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {allColIds.filter((id) => !visibleSet.has(id)).length > 0 && (
            <>
              <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1 mt-3">
                Скрытые
              </div>
              <div className="space-y-0.5 mb-2">
                {allColIds
                  .filter((id) => !visibleSet.has(id))
                  .map((colId) => {
                    const col = colMap[colId];
                    if (!col) return null;
                    return (
                      <div
                        key={colId}
                        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-slate-50 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => toggleColumn(colId)}
                          className="shrink-0 text-slate-400 hover:text-slate-600"
                          title="Показать"
                        >
                          <EyeOff className="size-3" />
                        </button>
                        <span className="flex-1 text-slate-400 truncate">
                          {col.label}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </>
          )}

          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-700 mt-2 px-1.5 py-0.5 rounded hover:bg-slate-50 w-full"
          >
            <RotateCcw className="size-2.5" />
            Сбросить
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Inline edit cell for select fields (portal-based)                         */
/* -------------------------------------------------------------------------- */

function InlineSelectCell<T extends string>({
  value,
  options,
  onCommit,
  onCancel,
  anchorRef,
}: {
  value: T;
  options: { key: T; label: string }[];
  onCommit: (val: T) => void;
  onCancel: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef?.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < 200 ? rect.top - 8 : rect.bottom + 4;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPos({ top, left: rect.left });
    }
  }, [anchorRef]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onCancel]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  if (!pos) return null;

  const openUp = pos.top > window.innerHeight / 2;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: openUp ? undefined : pos.top,
        bottom: openUp ? window.innerHeight - pos.top + 4 : undefined,
        left: pos.left,
        zIndex: 9999,
      }}
      className="min-w-[140px] max-h-[200px] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={(e) => {
            e.stopPropagation();
            onCommit(opt.key);
          }}
          className={cn(
            "flex w-full items-center px-3 py-1 text-[10px] hover:bg-slate-50 text-left",
            opt.key === value && "bg-violet-50 text-violet-700 font-medium"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>,
    document.body
  );
}

/* -------------------------------------------------------------------------- */
/*  Inline edit cell for date field (portal-based)                            */
/* -------------------------------------------------------------------------- */

function InlineDateCell({
  value,
  onCommit,
  onCancel,
  anchorRef,
}: {
  value: string;
  onCommit: (val: string | null) => void;
  onCancel: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef?.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < 200 ? rect.top - 8 : rect.bottom + 4;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPos({ top, left: rect.left });
    }
  }, [anchorRef]);

  useEffect(() => {
    if (!pos) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      try {
        el.showPicker();
      } catch {
        // showPicker may fail in some browsers
      }
    }
  }, [pos]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      )
        onCancel();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onCancel]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  if (!pos) return null;

  const openUp = pos.top > window.innerHeight / 2;

  return createPortal(
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        top: openUp ? undefined : pos.top,
        bottom: openUp ? window.innerHeight - pos.top + 4 : undefined,
        left: pos.left,
        zIndex: 9999,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => onCommit(e.target.value || null)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-6 rounded-md border border-slate-200 bg-white px-1.5 text-[10px] text-slate-700 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  );
}

/* -------------------------------------------------------------------------- */
/*  Standalone select dropdown for inline creation row (portal-based)         */
/* -------------------------------------------------------------------------- */

function CreationSelectDropdown<T extends string>({
  value,
  options,
  onSelect,
  anchorRef,
  onClose,
}: {
  value: T;
  options: { key: T; label: string }[];
  onSelect: (val: T) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef?.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < 200 ? rect.top - 8 : rect.bottom + 4;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPos({ top, left: rect.left });
    }
  }, [anchorRef]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!pos) return null;

  const openUp = pos.top > window.innerHeight / 2;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: openUp ? undefined : pos.top,
        bottom: openUp ? window.innerHeight - pos.top + 4 : undefined,
        left: pos.left,
        zIndex: 9999,
      }}
      className="min-w-[140px] max-h-[200px] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(opt.key);
            onClose();
          }}
          className={cn(
            "flex w-full items-center px-3 py-1 text-[10px] hover:bg-slate-50 text-left",
            opt.key === value && "bg-violet-50 text-violet-700 font-medium"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>,
    document.body
  );
}

/* -------------------------------------------------------------------------- */
/*  Bulk action dropdown                                                      */
/* -------------------------------------------------------------------------- */

function BulkActionDropdown({
  label,
  options,
  onSelect,
}: {
  label: string;
  options: { key: string; label: string }[];
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-blue-100 text-blue-700 transition-colors"
      >
        {label}
        <ChevronDown className="size-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[140px] max-h-[200px] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {options.map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                onSelect(opt.key);
                setOpen(false);
              }}
              className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-slate-50 text-left"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

const NEW_ITEM_DEFAULTS = {
  title: "",
  status: "inbox" as ItemStatus,
  priority: "none" as ItemPriority,
  category: "other" as ItemCategory,
  type: "task" as ItemType,
  due_date: "",
};

export function ListView() {
  const items = useFilteredItems();
  const createItem = useBrainStore((s) => s.createItem);
  const openDetail = useBrainStore((s) => s.openDetail);
  const editingItemId = useBrainStore((s) => s.editingItemId);
  const editingField = useBrainStore((s) => s.editingField);
  const setEditingItem = useBrainStore((s) => s.setEditingItem);
  const updateItem = useBrainStore((s) => s.updateItem);
  const reorderItems = useBrainStore((s) => s.reorderItems);
  const listColumnOrder = useBrainStore((s) => s.listColumnOrder);
  const setListColumnOrder = useBrainStore((s) => s.setListColumnOrder);
  const listGroupBy = useBrainStore((s) => s.listGroupBy);
  const setListGroupBy = useBrainStore((s) => s.setListGroupBy);
  const fetchItems = useBrainStore((s) => s.fetchItems);
  const categories = useBrainStore((s) => s.categories);
  const categoryConfig = useCategoryConfig();

  const [sort, setSort] = useState<SortState>({
    column: "created_at",
    direction: "desc",
  });

  const [manualOrder, setManualOrder] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  /* ----- Inline task creation state -------------------------------------- */
  const [isCreating, setIsCreating] = useState(false);
  const [newItem, setNewItem] = useState({ ...NEW_ITEM_DEFAULTS });
  const createTitleRef = useRef<HTMLInputElement>(null);
  const createCellRefs = useRef<Record<string, HTMLTableCellElement | null>>(
    {}
  );
  const [createDropdown, setCreateDropdown] = useState<string | null>(null);

  /* ----- Inline subtask creation state ----------------------------------- */
  const [creatingSubtaskFor, setCreatingSubtaskFor] = useState<string | null>(
    null
  );
  const [newSubtask, setNewSubtask] = useState({
    title: "",
    status: "todo" as ItemStatus,
    priority: "none" as ItemPriority,
    category: "other" as ItemCategory,
    type: "task" as ItemType,
    due_date: "",
  });
  const subtaskInputRef = useRef<HTMLInputElement>(null);
  const subtaskCellRefs = useRef<Record<string, HTMLTableCellElement | null>>(
    {}
  );
  const [subtaskDropdown, setSubtaskDropdown] = useState<string | null>(null);

  /* ----- Column definitions for current order ----------------------------- */

  const colMap = useMemo(
    () => Object.fromEntries(ALL_COLUMNS.map((c) => [c.id, c])),
    []
  );

  const visibleColumns = useMemo(
    () =>
      listColumnOrder.map((id) => colMap[id]).filter(Boolean) as ColumnDef[],
    [listColumnOrder, colMap]
  );

  /* ----- DnD sensors ----------------------------------------------------- */

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 3 },
    })
  );

  /* ----- sorting ---------------------------------------------------------- */

  const sortedItems = useMemo(() => {
    if (manualOrder) {
      const sorted = [...items];
      sorted.sort((a, b) => a.position - b.position);
      return sorted;
    }

    const sorted = [...items];
    const { column, direction } = sort;
    const dir = direction === "asc" ? 1 : -1;

    sorted.sort((a, b) => {
      let cmp = 0;

      switch (column) {
        case "title":
          cmp = a.title.localeCompare(b.title, "ru");
          break;
        case "status":
          cmp =
            (STATUS_WEIGHT[a.status] ?? 99) - (STATUS_WEIGHT[b.status] ?? 99);
          break;
        case "priority":
          cmp =
            (PRIORITY_WEIGHT[a.priority] ?? 99) -
            (PRIORITY_WEIGHT[b.priority] ?? 99);
          break;
        case "category":
          cmp = (categoryConfig[a.category]?.label ?? "").localeCompare(
            categoryConfig[b.category]?.label ?? "",
            "ru"
          );
          break;
        case "type":
          cmp = (TYPE_CONFIG[a.type]?.label ?? "").localeCompare(
            TYPE_CONFIG[b.type]?.label ?? "",
            "ru"
          );
          break;
        case "due_date": {
          const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
          const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
          cmp = da - db;
          break;
        }
        case "created_at": {
          cmp =
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime();
          break;
        }
      }

      return cmp * dir;
    });

    return sorted;
  }, [items, sort, manualOrder, categoryConfig]);

  /* ----- grouping ---------------------------------------------------------- */

  const groups = useMemo(
    () => groupItems(sortedItems, listGroupBy[0], categoryConfig),
    [sortedItems, listGroupBy, categoryConfig]
  );

  const isGrouped = listGroupBy[0] !== "none" && groups.length > 0;
  const hasLevel2 = listGroupBy[1] !== "none";

  const allGroupKeys = useMemo(() => {
    const keys: string[] = [];
    for (const g of groups) {
      keys.push(g.key);
      if (hasLevel2) {
        for (const sub of groupItems(g.items, listGroupBy[1], categoryConfig)) {
          keys.push(`${g.key}::${sub.key}`);
        }
      }
    }
    return keys;
  }, [groups, hasLevel2, listGroupBy, categoryConfig]);

  const allGroupsCollapsed = isGrouped && allGroupKeys.length > 0 && allGroupKeys.every((k) => collapsedGroups.has(k));

  const toggleAllGroups = useCallback(() => {
    if (allGroupsCollapsed) {
      setCollapsedGroups(new Set());
    } else {
      setCollapsedGroups(new Set(allGroupKeys));
    }
  }, [allGroupsCollapsed, allGroupKeys]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /* Build a set of item IDs per group key (for DnD restriction) */
  const groupItemIdSets = useMemo(() => {
    if (!isGrouped) return null;
    const map = new Map<string, Set<string>>();
    for (const group of groups) {
      const ids = new Set<string>();
      for (const item of group.items) {
        ids.add(item.id);
        if (item.subtasks) {
          for (const sub of item.subtasks) ids.add(sub.id);
        }
      }
      map.set(group.key, ids);
    }
    return map;
  }, [isGrouped, groups]);

  /* ----- flat rows -------------------------------------------------------- */

  const flatRows = useMemo(
    () => buildFlatRows(sortedItems, expandedItems),
    [sortedItems, expandedItems]
  );

  /* ----- IDs for SortableContext ------------------------------------------ */

  const topLevelIds = useMemo(
    () => flatRows.filter((r) => !r.isSubtask).map((r) => r.item.id),
    [flatRows]
  );

  const allRowIds = useMemo(() => flatRows.map((r) => r.item.id), [flatRows]);

  /* ----- Subtask sibling lookup (parentId -> ordered subtask ids) -------- */

  const subtaskSiblingMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of flatRows) {
      if (row.isSubtask && row.parentId) {
        if (!map.has(row.parentId)) map.set(row.parentId, []);
        map.get(row.parentId)!.push(row.item.id);
      }
    }
    return map;
  }, [flatRows]);

  const rowByIdMap = useMemo(() => {
    const map = new Map<string, FlatRow>();
    for (const row of flatRows) {
      map.set(row.item.id, row);
    }
    return map;
  }, [flatRows]);

  /* ----- column toggle ---------------------------------------------------- */

  const toggleSort = useCallback((column: SortColumn) => {
    setManualOrder(false);
    setSort((prev) => {
      if (prev.column === column) {
        return {
          column,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return { column, direction: "asc" };
    });
  }, []);

  /* ----- accordion toggle ------------------------------------------------- */

  const toggleExpanded = useCallback((id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* ----- selection helpers ------------------------------------------------ */

  const allSelected =
    topLevelIds.length > 0 && topLevelIds.every((id) => selectedIds.has(id));

  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(topLevelIds));
    }
  }, [allSelected, topLevelIds]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* ----- Bulk action handlers -------------------------------------------- */

  const handleBulkUpdate = useCallback(async (field: string, value: string) => {
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map(id =>
      fetch(`/api/items/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      })
    ));
    setSelectedIds(new Set());
    await fetchItems();
  }, [selectedIds, fetchItems]);

  const handleBulkDelete = useCallback(async () => {
    if (!confirm(`Удалить выбранные элементы (${selectedIds.size})?`)) return;
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map(id =>
      fetch(`/api/items/${id}`, { method: "DELETE" })
    ));
    setSelectedIds(new Set());
    await fetchItems();
  }, [selectedIds, fetchItems]);

  /* ----- DnD drag end handler -------------------------------------------- */

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over || active.id === over.id) return;

      const activeRow = rowByIdMap.get(active.id as string);
      const overRow = rowByIdMap.get(over.id as string);
      if (!activeRow || !overRow) return;

      /* --- If grouped, both items must belong to the same group --- */
      if (isGrouped && groupItemIdSets) {
        let sameGroup = false;
        for (const idSet of groupItemIdSets.values()) {
          if (idSet.has(active.id as string) && idSet.has(over.id as string)) {
            sameGroup = true;
            break;
          }
        }
        if (!sameGroup) return;
      }

      /* --- Subtask reorder: both must share the same parent --- */
      if (activeRow.isSubtask && activeRow.parentId) {
        if (!overRow.isSubtask || overRow.parentId !== activeRow.parentId)
          return;

        const siblingIds = subtaskSiblingMap.get(activeRow.parentId);
        if (!siblingIds) return;

        const oldIndex = siblingIds.indexOf(active.id as string);
        const newIndex = siblingIds.indexOf(over.id as string);
        if (oldIndex === -1 || newIndex === -1) return;

        const reordered = arrayMove(siblingIds, oldIndex, newIndex);
        const updates = reordered.map((id, index) => ({
          id,
          position: index,
        }));

        try {
          await reorderItems(updates);
        } catch {
          // fetchItems will restore correct state
        }
        return;
      }

      /* --- Top-level reorder (within group if grouped) --- */
      if (isGrouped) {
        // Find which group the active item belongs to
        const group = groups.find((g) => g.items.some((i) => i.id === active.id));
        if (!group) return;

        const groupIds = group.items.map((i) => i.id);
        const oldIndex = groupIds.indexOf(active.id as string);
        const newIndex = groupIds.indexOf(over.id as string);
        if (oldIndex === -1 || newIndex === -1) return;

        const reorderedGroup = arrayMove(group.items, oldIndex, newIndex);
        const updates = reorderedGroup.map((item, index) => ({
          id: item.id,
          position: index,
        }));

        setManualOrder(true);

        try {
          await reorderItems(updates);
        } catch {
          // fetchItems will restore correct state
        }
        return;
      }

      /* --- Flat reorder (no groups) --- */
      const oldIndex = topLevelIds.indexOf(active.id as string);
      const newIndex = topLevelIds.indexOf(over.id as string);

      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(sortedItems, oldIndex, newIndex);

      const updates = reordered.map((item, index) => ({
        id: item.id,
        position: index,
      }));

      setManualOrder(true);

      try {
        await reorderItems(updates);
      } catch {
        // fetchItems will restore correct state
      }
    },
    [topLevelIds, sortedItems, reorderItems, rowByIdMap, subtaskSiblingMap, isGrouped, groupItemIdSets, groups]
  );

  /* ----- Inline task creation handlers ----------------------------------- */

  const handleStartCreate = useCallback(() => {
    setIsCreating(true);
    setNewItem({ ...NEW_ITEM_DEFAULTS });
    setCreateDropdown(null);
    // Auto-focus title after render
    setTimeout(() => createTitleRef.current?.focus(), 0);
  }, []);

  const handleCancelCreate = useCallback(() => {
    setIsCreating(false);
    setNewItem({ ...NEW_ITEM_DEFAULTS });
    setCreateDropdown(null);
  }, []);

  const handleCommitCreate = useCallback(async () => {
    if (!newItem.title.trim()) {
      handleCancelCreate();
      return;
    }
    try {
      await createItem({
        title: newItem.title.trim(),
        status: newItem.status,
        priority: newItem.priority,
        category: newItem.category,
        type: newItem.type,
        due_date: newItem.due_date || null,
      });
    } catch {
      // silently fail
    }
    setIsCreating(false);
    setNewItem({ ...NEW_ITEM_DEFAULTS });
    setCreateDropdown(null);
  }, [newItem, createItem, handleCancelCreate]);

  /* ----- Inline subtask creation handlers -------------------------------- */

  const handleStartSubtaskCreate = useCallback(
    (parentId: string) => {
      const parent = sortedItems.find((i) => i.id === parentId);
      setCreatingSubtaskFor(parentId);
      setNewSubtask({
        title: "",
        status: "todo" as ItemStatus,
        priority: "none" as ItemPriority,
        category: (parent?.category ?? "other") as ItemCategory,
        type: "task" as ItemType,
        due_date: "",
      });
      setSubtaskDropdown(null);
      // Expand parent if not expanded
      setExpandedItems((prev) => {
        const next = new Set(prev);
        next.add(parentId);
        return next;
      });
      setTimeout(() => subtaskInputRef.current?.focus(), 0);
    },
    [sortedItems]
  );

  const handleCancelSubtaskCreate = useCallback(() => {
    setCreatingSubtaskFor(null);
    setNewSubtask({
      title: "",
      status: "todo" as ItemStatus,
      priority: "none" as ItemPriority,
      category: "other" as ItemCategory,
      type: "task" as ItemType,
      due_date: "",
    });
    setSubtaskDropdown(null);
  }, []);

  const handleCommitSubtaskCreate = useCallback(async () => {
    if (!newSubtask.title.trim() || !creatingSubtaskFor) {
      handleCancelSubtaskCreate();
      return;
    }
    try {
      await createItem({
        title: newSubtask.title.trim(),
        parent_id: creatingSubtaskFor,
        status: newSubtask.status,
        priority: newSubtask.priority,
        category: newSubtask.category,
        type: newSubtask.type,
        due_date: newSubtask.due_date || null,
      });
    } catch {
      // silently fail
    }
    setCreatingSubtaskFor(null);
    setNewSubtask({
      title: "",
      status: "todo" as ItemStatus,
      priority: "none" as ItemPriority,
      category: "other" as ItemCategory,
      type: "task" as ItemType,
      due_date: "",
    });
    setSubtaskDropdown(null);
  }, [
    newSubtask,
    creatingSubtaskFor,
    createItem,
    handleCancelSubtaskCreate,
  ]);

  /* ----- Select option builders ------------------------------------------ */

  const statusOptions = useMemo(
    () =>
      (
        Object.entries(STATUS_CONFIG) as [
          ItemStatus,
          (typeof STATUS_CONFIG)[ItemStatus],
        ][]
      ).map(([key, cfg]) => ({ key, label: cfg.label })),
    []
  );

  const priorityOptions = useMemo(
    () =>
      (
        Object.entries(PRIORITY_CONFIG) as [
          ItemPriority,
          (typeof PRIORITY_CONFIG)[ItemPriority],
        ][]
      ).map(([key, cfg]) => ({ key, label: `${cfg.icon} ${cfg.label}` })),
    []
  );

  const categoryOptions = useMemo(
    () =>
      categories.map((cat) => ({ key: cat.id, label: cat.name })),
    [categories]
  );

  const typeOptions = useMemo(
    () =>
      (
        Object.entries(TYPE_CONFIG) as [
          ItemType,
          (typeof TYPE_CONFIG)[ItemType],
        ][]
      ).map(([key, cfg]) => ({ key, label: cfg.label })),
    []
  );

  /* ----- Render creation-row cell by column id --------------------------- */

  const renderCreateCell = (colId: string) => {
    switch (colId) {
      case "priority": {
        const cfg = PRIORITY_CONFIG[newItem.priority];
        return (
          <td
            key={colId}
            ref={(el) => {
              createCellRefs.current["priority"] = el;
            }}
            className="relative px-3 py-1.5 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setCreateDropdown(
                createDropdown === "priority" ? null : "priority"
              );
            }}
          >
            <span className="text-xs leading-none">{cfg.icon}</span>
            {createDropdown === "priority" && (
              <CreationSelectDropdown
                value={newItem.priority}
                options={priorityOptions}
                onSelect={(val) =>
                  setNewItem((prev) => ({ ...prev, priority: val }))
                }
                anchorRef={{
                  current: createCellRefs.current["priority"],
                }}
                onClose={() => setCreateDropdown(null)}
              />
            )}
          </td>
        );
      }

      case "title":
        return (
          <td key={colId} className="px-3 py-1.5">
            <input
              ref={createTitleRef}
              type="text"
              placeholder="Название задачи..."
              value={newItem.title}
              onChange={(e) =>
                setNewItem((prev) => ({ ...prev, title: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCommitCreate();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  handleCancelCreate();
                }
              }}
              className="w-full h-6 bg-transparent text-xs text-slate-900 placeholder:text-slate-400 outline-none border-b border-blue-300 focus:border-blue-500"
            />
          </td>
        );

      case "status": {
        const cfg = STATUS_CONFIG[newItem.status];
        return (
          <td
            key={colId}
            ref={(el) => {
              createCellRefs.current["status"] = el;
            }}
            className="relative px-3 py-1.5 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setCreateDropdown(
                createDropdown === "status" ? null : "status"
              );
            }}
          >
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] font-medium px-1.5 py-0 rounded-md",
                cfg.color
              )}
            >
              {cfg.label}
            </Badge>
            {createDropdown === "status" && (
              <CreationSelectDropdown
                value={newItem.status}
                options={statusOptions}
                onSelect={(val) =>
                  setNewItem((prev) => ({ ...prev, status: val }))
                }
                anchorRef={{
                  current: createCellRefs.current["status"],
                }}
                onClose={() => setCreateDropdown(null)}
              />
            )}
          </td>
        );
      }

      case "category": {
        const cfg = categoryConfig[newItem.category];
        return (
          <td
            key={colId}
            ref={(el) => {
              createCellRefs.current["category"] = el;
            }}
            className="relative px-3 py-1.5 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setCreateDropdown(
                createDropdown === "category" ? null : "category"
              );
            }}
          >
            <Badge
              variant="outline"
              className="text-[10px] font-normal rounded-md border-slate-200 text-slate-600"
            >
              {cfg?.label ?? newItem.category}
            </Badge>
            {createDropdown === "category" && (
              <CreationSelectDropdown
                value={newItem.category}
                options={categoryOptions}
                onSelect={(val) =>
                  setNewItem((prev) => ({ ...prev, category: val }))
                }
                anchorRef={{
                  current: createCellRefs.current["category"],
                }}
                onClose={() => setCreateDropdown(null)}
              />
            )}
          </td>
        );
      }

      case "type": {
        const cfg = TYPE_CONFIG[newItem.type];
        return (
          <td
            key={colId}
            ref={(el) => {
              createCellRefs.current["type"] = el;
            }}
            className="relative px-3 py-1.5 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setCreateDropdown(
                createDropdown === "type" ? null : "type"
              );
            }}
          >
            <span className="text-xs text-slate-600">{cfg.label}</span>
            {createDropdown === "type" && (
              <CreationSelectDropdown
                value={newItem.type}
                options={typeOptions}
                onSelect={(val) =>
                  setNewItem((prev) => ({ ...prev, type: val }))
                }
                anchorRef={{
                  current: createCellRefs.current["type"],
                }}
                onClose={() => setCreateDropdown(null)}
              />
            )}
          </td>
        );
      }

      case "due_date": {
        return (
          <td key={colId} className="px-3 py-1.5">
            <input
              type="date"
              value={newItem.due_date}
              onChange={(e) =>
                setNewItem((prev) => ({
                  ...prev,
                  due_date: e.target.value,
                }))
              }
              className="h-5 rounded border border-slate-200 bg-white px-1 text-[10px] text-slate-600 outline-none focus:border-blue-400"
            />
          </td>
        );
      }

      case "subtasks":
        return (
          <td key={colId} className="px-3 py-1.5">
            <span className="text-xs text-slate-300">--</span>
          </td>
        );

      default:
        return <td key={colId} />;
    }
  };

  /* ----- Escape handler for creation mode (global) ----------------------- */

  useEffect(() => {
    if (!isCreating) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        handleCancelCreate();
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isCreating, handleCancelCreate]);

  /* ----- renderFlatRows helper -------------------------------------------- */

  const renderFlatRows = (rows: FlatRow[]) =>
    rows.map((row, idx) => {
      const isLastSubtaskOfParent =
        row.isSubtask &&
        row.parentId &&
        (idx === rows.length - 1 ||
          rows[idx + 1].parentId !== row.parentId ||
          !rows[idx + 1].isSubtask);
      const parentRow = !row.isSubtask ? row : null;
      const isDetachedSubtask = !!row.item.parent_id && !row.isSubtask;
      const isExpandedParentWithNoSubtasks =
        parentRow &&
        !isDetachedSubtask &&
        expandedItems.has(row.item.id) &&
        !parentRow.hasSubtasks;
      const showAddSubtaskAfter = isDetachedSubtask
        ? false
        : isLastSubtaskOfParent || isExpandedParentWithNoSubtasks;
      const addSubtaskParentId = row.isSubtask
        ? row.parentId
        : row.item.id;

      return (
        <ItemRowGroup
          key={`${row.parentId ?? "root"}-${row.item.id}`}
          row={row}
          selected={selectedIds.has(row.item.id)}
          onSelect={toggleOne}
          onOpen={openDetail}
          editingField={
            editingItemId === row.item.id ? editingField : null
          }
          setEditingItem={setEditingItem}
          updateItem={updateItem}
          isExpanded={expandedItems.has(row.item.id)}
          onToggleExpand={toggleExpanded}
          visibleColumns={visibleColumns}
          showAddSubtaskRow={
            !!(showAddSubtaskAfter && addSubtaskParentId !== null)
          }
          addSubtaskParentId={addSubtaskParentId}
          creatingSubtaskFor={creatingSubtaskFor}
          onStartSubtaskCreate={handleStartSubtaskCreate}
          newSubtask={newSubtask}
          setNewSubtask={setNewSubtask}
          onCommitSubtaskCreate={handleCommitSubtaskCreate}
          onCancelSubtaskCreate={handleCancelSubtaskCreate}
          subtaskInputRef={subtaskInputRef}
          subtaskCellRefs={subtaskCellRefs}
          subtaskDropdown={subtaskDropdown}
          setSubtaskDropdown={setSubtaskDropdown}
          statusOptions={statusOptions}
          priorityOptions={priorityOptions}
          categoryOptions={categoryOptions}
          typeOptions={typeOptions}
        />
      );
    });

  /* ----- render ----------------------------------------------------------- */

  if (items.length === 0 && !isCreating) {
    return (
      <div>
        <div className="p-2">
          <button
            type="button"
            onClick={handleStartCreate}
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 transition-colors px-2 py-1 rounded hover:bg-slate-100"
          >
            <Plus className="size-3.5" />
            Добавить задачу
          </button>
        </div>
        {isCreating ? null : <EmptyState />}
      </div>
    );
  }

  return (
    <ScrollArea className="h-full w-full">
      <div className="min-w-[900px]">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={allRowIds}
            strategy={verticalListSortingStrategy}
          >
            <table className="w-full border-collapse bg-white border border-t-0 border-slate-200 rounded-b-lg">
              {/* ---- Header ------------------------------------------- */}
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200">
                  {/* Drag handle column header */}
                  <th className="w-7 px-1 py-2 text-left" />

                  {/* Expand toggle */}
                  <th className="w-8 px-1 py-2 text-left" />

                  {/* Checkbox */}
                  <th className="w-8 px-1.5 py-2 text-left">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onCheckedChange={toggleAll}
                      className="translate-y-[1px]"
                    />
                  </th>

                  {/* Dynamic columns */}
                  {visibleColumns.map((col) =>
                    col.sortable ? (
                      <SortableHeader
                        key={col.id}
                        label={col.label}
                        column={col.id as SortColumn}
                        current={sort}
                        onToggle={toggleSort}
                        className={col.width}
                        isManualOrder={manualOrder}
                      />
                    ) : (
                      <th
                        key={col.id}
                        className={cn(
                          col.width,
                          "px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500"
                        )}
                      >
                        {col.label}
                      </th>
                    )
                  )}

                  {/* Column config & grouping buttons */}
                  <th className="w-16 px-1 py-2">
                    <div className="flex items-center gap-0.5 justify-end">
                      {isGrouped && (
                        <button
                          type="button"
                          onClick={toggleAllGroups}
                          className="inline-flex items-center justify-center size-6 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                          title={allGroupsCollapsed ? "Раскрыть всё" : "Свернуть всё"}
                        >
                          <ChevronsUpDown className="size-3.5" />
                        </button>
                      )}
                      <GroupByPopover
                        value={listGroupBy}
                        onChange={setListGroupBy}
                      />
                      <ColumnConfigPopover
                        columnOrder={listColumnOrder}
                        onOrderChange={setListColumnOrder}
                      />
                    </div>
                  </th>
                </tr>

                {/* ---- Bulk actions bar -------------------------------- */}
                {selectedIds.size > 0 && (
                  <tr className="bg-blue-50 border-b border-blue-200">
                    <td colSpan={visibleColumns.length + 4} className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-medium text-blue-700">
                          Выбрано: {selectedIds.size}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedIds(new Set())}
                          className="inline-flex items-center justify-center size-5 rounded hover:bg-blue-200/70 text-blue-500 transition-colors"
                          title="Снять выделение"
                        >
                          <X className="size-3" />
                        </button>
                        <div className="h-4 w-px bg-blue-200 mx-0.5" />
                        <BulkActionDropdown
                          label="Статус"
                          options={statusOptions}
                          onSelect={(val) => handleBulkUpdate("status", val)}
                        />
                        <BulkActionDropdown
                          label="Приоритет"
                          options={priorityOptions}
                          onSelect={(val) => handleBulkUpdate("priority", val)}
                        />
                        <BulkActionDropdown
                          label="Категория"
                          options={categoryOptions}
                          onSelect={(val) => handleBulkUpdate("category", val)}
                        />
                        <BulkActionDropdown
                          label="Тип"
                          options={typeOptions}
                          onSelect={(val) => handleBulkUpdate("type", val)}
                        />
                        <div className="h-4 w-px bg-blue-200 mx-0.5" />
                        <button
                          type="button"
                          onClick={() => handleBulkUpdate("status", "archived")}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-amber-100 text-amber-700 transition-colors"
                          title="В архив"
                        >
                          <Archive className="size-3" />
                          В архив
                        </button>
                        <button
                          type="button"
                          onClick={handleBulkDelete}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-red-100 text-red-600 transition-colors"
                          title="Удалить"
                        >
                          <Trash2 className="size-3" />
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </thead>

              {/* ---- Body --------------------------------------------- */}
              <tbody className="divide-y divide-slate-100">
                {/* === Inline creation row === */}
                {!isCreating ? (
                  <tr
                    className="hover:bg-slate-50/50 cursor-pointer group"
                    onClick={handleStartCreate}
                  >
                    <td className="px-1 py-1.5" />
                    <td className="px-1 py-1.5" />
                    <td className="px-1.5 py-1.5">
                      <Plus className="size-3.5 text-slate-400 group-hover:text-blue-500 transition-colors" />
                    </td>
                    <td
                      colSpan={visibleColumns.length}
                      className="px-3 py-1.5"
                    >
                      <span className="text-xs text-slate-400 group-hover:text-blue-500 transition-colors">
                        Добавить задачу
                      </span>
                    </td>
                    <td className="w-16" />
                  </tr>
                ) : (
                  <tr className="bg-blue-50/40 ring-1 ring-inset ring-blue-200">
                    {/* Drag handle placeholder */}
                    <td className="px-1 py-1.5" />
                    {/* Expand placeholder */}
                    <td className="px-1 py-1.5" />
                    {/* Action buttons */}
                    <td className="px-1.5 py-1.5">
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCommitCreate();
                          }}
                          className="inline-flex items-center justify-center size-5 rounded hover:bg-emerald-100 text-emerald-600 transition-colors"
                          title="Создать"
                        >
                          <Check className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancelCreate();
                          }}
                          className="inline-flex items-center justify-center size-5 rounded hover:bg-red-100 text-red-500 transition-colors"
                          title="Отмена"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </td>
                    {/* Dynamic creation cells */}
                    {/* eslint-disable-next-line react-hooks/refs */}
                    {visibleColumns.map((col) => renderCreateCell(col.id))}
                    {/* Settings spacer */}
                    <td className="w-16" />
                  </tr>
                )}

                {/* === Data rows (grouped or flat) === */}
                {isGrouped
                  ? groups.map((group) => {
                      const l1Key = group.key;
                      const groupCollapsed = collapsedGroups.has(l1Key);
                      const colCount = visibleColumns.length + 4;

                      // Level 2 sub-groups
                      const level2Groups = hasLevel2
                        ? groupItems(group.items, listGroupBy[1], categoryConfig)
                        : null;

                      return (
                        <GroupSection
                          key={l1Key}
                          group={group}
                          collapsed={groupCollapsed}
                          onToggle={() => toggleGroup(l1Key)}
                          colCount={colCount}
                          depth={0}
                        >
                          {!groupCollapsed && (level2Groups
                            ? level2Groups.map((subGroup) => {
                                const l2Key = `${l1Key}::${subGroup.key}`;
                                const l2Collapsed = collapsedGroups.has(l2Key);
                                const l2FlatRows = buildFlatRows(subGroup.items, expandedItems);

                                return (
                                  <GroupSection
                                    key={l2Key}
                                    group={subGroup}
                                    collapsed={l2Collapsed}
                                    onToggle={() => toggleGroup(l2Key)}
                                    colCount={colCount}
                                    depth={1}
                                  >
                                    {!l2Collapsed &&
                                      renderFlatRows(l2FlatRows)}
                                  </GroupSection>
                                );
                              })
                            : renderFlatRows(buildFlatRows(group.items, expandedItems))
                          )}
                        </GroupSection>
                      );
                    })
                  : renderFlatRows(flatRows)}
              </tbody>
            </table>
          </SortableContext>
        </DndContext>
      </div>
    </ScrollArea>
  );
}

/* -------------------------------------------------------------------------- */
/*  Group section header row                                                  */
/* -------------------------------------------------------------------------- */

function GroupSection({
  group,
  collapsed,
  onToggle,
  colCount,
  depth = 0,
  children,
}: {
  group: ItemGroup;
  collapsed: boolean;
  onToggle: () => void;
  colCount: number;
  depth?: number;
  children: React.ReactNode;
}) {
  const isNested = depth > 0;

  return (
    <>
      <tr
        className={cn(
          "hover:bg-slate-200/60 cursor-pointer transition-colors border-t border-slate-200",
          isNested ? "bg-slate-50/90" : "bg-slate-100/80"
        )}
        onClick={onToggle}
      >
        <td colSpan={colCount} className="px-3 py-2">
          <div
            className="flex items-center gap-2"
            style={{ paddingLeft: isNested ? 20 : 0 }}
          >
            <button
              type="button"
              className="inline-flex items-center justify-center size-4 rounded hover:bg-slate-300/50 transition-colors text-slate-500"
            >
              {collapsed ? (
                <ChevronRight className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
            {group.icon && (
              <span className="text-sm leading-none">{group.icon}</span>
            )}
            <span
              className={cn(
                "font-semibold",
                isNested ? "text-[11px] text-slate-600" : "text-xs text-slate-700"
              )}
            >
              {group.label}
            </span>
            <span className="text-[10px] text-slate-400 tabular-nums">
              {group.items.length}
            </span>
          </div>
        </td>
      </tr>
      {children}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sortable column header                                                    */
/* -------------------------------------------------------------------------- */

function SortableHeader({
  label,
  column,
  current,
  onToggle,
  className,
  isManualOrder,
}: {
  label: string;
  column: SortColumn;
  current: SortState;
  onToggle: (col: SortColumn) => void;
  className?: string;
  isManualOrder: boolean;
}) {
  const isActive = !isManualOrder && current.column === column;

  return (
    <th className={cn("px-3 py-2 text-left", className)}>
      <button
        type="button"
        onClick={() => onToggle(column)}
        className={cn(
          "inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider transition-colors",
          isActive
            ? "text-slate-900"
            : "text-slate-500 hover:text-slate-900"
        )}
      >
        {label}
        {isActive ? (
          current.direction === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

/* -------------------------------------------------------------------------- */
/*  ItemRowGroup: renders the main row + optional "add subtask" row           */
/* -------------------------------------------------------------------------- */

function ItemRowGroup({
  row,
  selected,
  onSelect,
  onOpen,
  editingField,
  setEditingItem,
  updateItem,
  isExpanded,
  onToggleExpand,
  visibleColumns,
  showAddSubtaskRow,
  addSubtaskParentId,
  creatingSubtaskFor,
  onStartSubtaskCreate,
  newSubtask,
  setNewSubtask,
  onCommitSubtaskCreate,
  onCancelSubtaskCreate,
  subtaskInputRef,
  subtaskCellRefs,
  subtaskDropdown,
  setSubtaskDropdown,
  statusOptions,
  priorityOptions,
  categoryOptions,
  typeOptions,
}: {
  row: FlatRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  editingField: string | null;
  setEditingItem: (id: string | null, field?: string | null) => void;
  updateItem: (id: string, payload: Record<string, unknown>) => Promise<void>;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  visibleColumns: ColumnDef[];
  showAddSubtaskRow: boolean;
  addSubtaskParentId: string | null;
  creatingSubtaskFor: string | null;
  onStartSubtaskCreate: (parentId: string) => void;
  newSubtask: {
    title: string;
    status: ItemStatus;
    priority: ItemPriority;
    category: ItemCategory;
    type: ItemType;
    due_date: string;
  };
  setNewSubtask: React.Dispatch<React.SetStateAction<{
    title: string;
    status: ItemStatus;
    priority: ItemPriority;
    category: ItemCategory;
    type: ItemType;
    due_date: string;
  }>>;
  onCommitSubtaskCreate: () => void;
  onCancelSubtaskCreate: () => void;
  subtaskInputRef: React.RefObject<HTMLInputElement | null>;
  subtaskCellRefs: React.MutableRefObject<Record<string, HTMLTableCellElement | null>>;
  subtaskDropdown: string | null;
  setSubtaskDropdown: (val: string | null) => void;
  statusOptions: { key: ItemStatus; label: string }[];
  priorityOptions: { key: ItemPriority; label: string }[];
  categoryOptions: { key: ItemCategory; label: string }[];
  typeOptions: { key: ItemType; label: string }[];
}) {
  const catConfig = useCategoryConfig();
  const colCount = visibleColumns.length + 4; // drag + expand + checkbox + settings

  return (
    <>
      <ItemRow
        row={row}
        selected={selected}
        onSelect={onSelect}
        onOpen={onOpen}
        editingField={editingField}
        setEditingItem={setEditingItem}
        updateItem={updateItem}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
        visibleColumns={visibleColumns}
        statusOptions={statusOptions}
        priorityOptions={priorityOptions}
        categoryOptions={categoryOptions}
        typeOptions={typeOptions}
      />

      {/* "Add subtask" row after last subtask or after expanded empty parent */}
      {showAddSubtaskRow && addSubtaskParentId && (
        <>
          {creatingSubtaskFor === addSubtaskParentId ? (
            <tr className="bg-blue-50/30 ring-1 ring-inset ring-blue-200">
              {/* Drag handle placeholder */}
              <td className="px-1 py-1" />
              {/* Expand placeholder */}
              <td className="px-1 py-1" />
              {/* Action buttons */}
              <td className="px-1.5 py-1">
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCommitSubtaskCreate();
                    }}
                    className="inline-flex items-center justify-center size-4 rounded hover:bg-emerald-100 text-emerald-600 transition-colors"
                  >
                    <Check className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelSubtaskCreate();
                    }}
                    className="inline-flex items-center justify-center size-4 rounded hover:bg-red-100 text-red-500 transition-colors"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </td>
              {/* Dynamic subtask creation cells */}
              {visibleColumns.map((col) => {
                switch (col.id) {
                  case "priority": {
                    const cfg = PRIORITY_CONFIG[newSubtask.priority];
                    return (
                      <td
                        key={col.id}
                        ref={(el) => {
                          subtaskCellRefs.current["priority"] = el;
                        }}
                        className="relative px-3 py-1 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSubtaskDropdown(
                            subtaskDropdown === "priority" ? null : "priority"
                          );
                        }}
                      >
                        <span className="text-xs leading-none">{cfg.icon}</span>
                        {subtaskDropdown === "priority" && (
                          <CreationSelectDropdown
                            value={newSubtask.priority}
                            options={priorityOptions}
                            onSelect={(val) =>
                              setNewSubtask((prev) => ({ ...prev, priority: val }))
                            }
                            anchorRef={{
                              current: subtaskCellRefs.current["priority"],
                            }}
                            onClose={() => setSubtaskDropdown(null)}
                          />
                        )}
                      </td>
                    );
                  }

                  case "title":
                    return (
                      <td key={col.id} className="px-3 py-1">
                        <div className="flex items-center gap-1.5 pl-4">
                          <span className="text-slate-300 text-[10px] select-none">
                            {"\u21B3"}
                          </span>
                          <input
                            ref={subtaskInputRef}
                            type="text"
                            placeholder="Название подзадачи..."
                            value={newSubtask.title}
                            onChange={(e) =>
                              setNewSubtask((prev) => ({ ...prev, title: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                onCommitSubtaskCreate();
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                onCancelSubtaskCreate();
                              }
                            }}
                            className="flex-1 h-5 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none border-b border-blue-200 focus:border-blue-400"
                          />
                        </div>
                      </td>
                    );

                  case "status": {
                    const cfg = STATUS_CONFIG[newSubtask.status];
                    return (
                      <td
                        key={col.id}
                        ref={(el) => {
                          subtaskCellRefs.current["status"] = el;
                        }}
                        className="relative px-3 py-1 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSubtaskDropdown(
                            subtaskDropdown === "status" ? null : "status"
                          );
                        }}
                      >
                        <Badge
                          variant="secondary"
                          className={cn(
                            "text-[10px] font-medium px-1.5 py-0 rounded-md",
                            cfg.color
                          )}
                        >
                          {cfg.label}
                        </Badge>
                        {subtaskDropdown === "status" && (
                          <CreationSelectDropdown
                            value={newSubtask.status}
                            options={statusOptions}
                            onSelect={(val) =>
                              setNewSubtask((prev) => ({ ...prev, status: val }))
                            }
                            anchorRef={{
                              current: subtaskCellRefs.current["status"],
                            }}
                            onClose={() => setSubtaskDropdown(null)}
                          />
                        )}
                      </td>
                    );
                  }

                  case "category": {
                    const cfg = catConfig[newSubtask.category];
                    return (
                      <td
                        key={col.id}
                        ref={(el) => {
                          subtaskCellRefs.current["category"] = el;
                        }}
                        className="relative px-3 py-1 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSubtaskDropdown(
                            subtaskDropdown === "category" ? null : "category"
                          );
                        }}
                      >
                        <Badge
                          variant="outline"
                          className="text-[10px] font-normal rounded-md border-slate-200 text-slate-600"
                        >
                          {cfg?.label ?? newSubtask.category}
                        </Badge>
                        {subtaskDropdown === "category" && (
                          <CreationSelectDropdown
                            value={newSubtask.category}
                            options={categoryOptions}
                            onSelect={(val) =>
                              setNewSubtask((prev) => ({ ...prev, category: val }))
                            }
                            anchorRef={{
                              current: subtaskCellRefs.current["category"],
                            }}
                            onClose={() => setSubtaskDropdown(null)}
                          />
                        )}
                      </td>
                    );
                  }

                  case "type": {
                    const cfg = TYPE_CONFIG[newSubtask.type];
                    return (
                      <td
                        key={col.id}
                        ref={(el) => {
                          subtaskCellRefs.current["type"] = el;
                        }}
                        className="relative px-3 py-1 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSubtaskDropdown(
                            subtaskDropdown === "type" ? null : "type"
                          );
                        }}
                      >
                        <span className="text-xs text-slate-600">{cfg.label}</span>
                        {subtaskDropdown === "type" && (
                          <CreationSelectDropdown
                            value={newSubtask.type}
                            options={typeOptions}
                            onSelect={(val) =>
                              setNewSubtask((prev) => ({ ...prev, type: val }))
                            }
                            anchorRef={{
                              current: subtaskCellRefs.current["type"],
                            }}
                            onClose={() => setSubtaskDropdown(null)}
                          />
                        )}
                      </td>
                    );
                  }

                  case "due_date":
                    return (
                      <td key={col.id} className="px-3 py-1">
                        <input
                          type="date"
                          value={newSubtask.due_date}
                          onChange={(e) =>
                            setNewSubtask((prev) => ({
                              ...prev,
                              due_date: e.target.value,
                            }))
                          }
                          className="h-5 rounded border border-slate-200 bg-white px-1 text-[10px] text-slate-600 outline-none focus:border-blue-400"
                        />
                      </td>
                    );

                  case "subtasks":
                    return (
                      <td key={col.id} className="px-3 py-1">
                        <span className="text-xs text-slate-300">--</span>
                      </td>
                    );

                  default:
                    return <td key={col.id} />;
                }
              })}
              {/* Settings spacer */}
              <td className="w-8" />
            </tr>
          ) : (
            <tr
              className="hover:bg-slate-50/50 cursor-pointer group/sub"
              onClick={() => onStartSubtaskCreate(addSubtaskParentId)}
            >
              <td className="px-1 py-1" />
              <td className="px-1 py-1" />
              <td className="px-1.5 py-1">
                <Plus className="size-3 text-slate-300 group-hover/sub:text-blue-500 transition-colors" />
              </td>
              <td colSpan={colCount - 3} className="px-3 py-1">
                <span className="text-[10px] text-slate-400 group-hover/sub:text-blue-500 transition-colors pl-5">
                  Добавить подзадачу
                </span>
              </td>
            </tr>
          )}
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Table row                                                                 */
/* -------------------------------------------------------------------------- */

function ItemRow({
  row,
  selected,
  onSelect,
  onOpen,
  editingField,
  setEditingItem,
  updateItem,
  isExpanded,
  onToggleExpand,
  visibleColumns,
  statusOptions,
  priorityOptions,
  categoryOptions,
  typeOptions,
}: {
  row: FlatRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  editingField: string | null;
  setEditingItem: (id: string | null, field?: string | null) => void;
  updateItem: (id: string, payload: Record<string, unknown>) => Promise<void>;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  visibleColumns: ColumnDef[];
  statusOptions: { key: ItemStatus; label: string }[];
  priorityOptions: { key: ItemPriority; label: string }[];
  categoryOptions: { key: ItemCategory; label: string }[];
  typeOptions: { key: ItemType; label: string }[];
}) {
  const { item, isSubtask, totalSubtasks, doneSubtasks } = row;
  const allItems = useBrainStore((s) => s.items);
  const relCount = useBrainStore((s) => s.itemRelationCounts[item.id] ?? 0);
  const commentCount = useBrainStore((s) => s.itemCommentCounts[item.id] ?? 0);
  const isDetachedSubtask = !isSubtask && !!item.parent_id;
  const parentItem = isDetachedSubtask ? allItems.find((i) => i.id === item.parent_id) : null;

  /* ----- Ref map for cells that need portal-based dropdowns -------------- */
  const cellRefs = useRef<Record<string, HTMLTableCellElement | null>>({});

  /* ----- DnD sortable ---------------------------------------------------- */

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    animateLayoutChanges: () => false,
  });

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
  };

  const itemCategoryConfig = useCategoryConfig();
  const statusCfg = STATUS_CONFIG[item.status as ItemStatus];
  const priorityCfg = PRIORITY_CONFIG[item.priority as ItemPriority];
  const categoryCfg = itemCategoryConfig[item.category];
  const typeCfg = TYPE_CONFIG[item.type as ItemType];

  /* Due date logic */
  const dueDate = item.due_date ? parseISO(item.due_date) : null;
  const isOverdue =
    dueDate &&
    !isToday(dueDate) &&
    isPast(dueDate) &&
    item.status !== "done" &&
    item.status !== "archived";

  /* ----- Inline edit commit helper --------------------------------------- */

  const commitFieldEdit = useCallback(
    async (field: string, value: unknown) => {
      await updateItem(item.id, { [field]: value });
      setEditingItem(null);
    },
    [item.id, updateItem, setEditingItem]
  );

  const cancelEdit = useCallback(() => {
    setEditingItem(null);
  }, [setEditingItem]);

  /* ----- Click handlers for cells ---------------------------------------- */

  const handleCellClick = useCallback(
    (field: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (field === "title" || field === "subtasks") {
        onOpen(item.id);
      } else {
        setEditingItem(item.id, field);
      }
    },
    [item.id, onOpen, setEditingItem]
  );

  /* ----- Accordion chevron ------------------------------------------------ */

  const showChevron = !isSubtask && !item.parent_id;

  /* ----- Row classes ------------------------------------------------------ */

  const rowCls = cn(
    "group transition-colors",
    isSubtask
      ? "bg-slate-50/60 hover:bg-slate-100/60"
      : selected
        ? "bg-blue-50/60"
        : "hover:bg-slate-50/50",
    editingField && "ring-1 ring-inset ring-blue-300 bg-blue-50/30",
    isDragging && "opacity-50"
  );

  /* ----- Render a cell by column id --------------------------------------- */

  const renderCell = (colId: string) => {
    switch (colId) {
      case "priority": {
        return (
          <td
            key={colId}
            ref={(el) => {
              cellRefs.current["priority"] = el;
            }}
            className="relative px-3 py-1.5 cursor-pointer"
            onClick={(e) => handleCellClick("priority", e)}
          >
            {!isSubtask && (
              <div className="flex items-center gap-1">
                <span className="text-xs leading-none">{priorityCfg.icon}</span>
              </div>
            )}
            {editingField === "priority" && (
              <InlineSelectCell
                value={item.priority as ItemPriority}
                options={priorityOptions}
                onCommit={(val) => commitFieldEdit("priority", val)}
                onCancel={cancelEdit}
                anchorRef={{ current: cellRefs.current["priority"] }}
              />
            )}
          </td>
        );
      }

      case "title": {
        return (
          <td
            key={colId}
            className="px-3 py-1.5 cursor-pointer"
            onClick={(e) => handleCellClick("title", e)}
          >
            {isDetachedSubtask && parentItem && (
              <span className="text-[9px] text-slate-400 block leading-tight truncate mb-0.5">
                {parentItem.title}
              </span>
            )}
            <span
              className={cn(
                "text-xs font-medium leading-snug line-clamp-1 transition-colors",
                isSubtask
                  ? "text-slate-600 pl-4"
                  : isDetachedSubtask
                    ? "text-slate-700 group-hover:text-blue-600"
                    : "text-slate-900 group-hover:text-blue-600"
              )}
            >
              {isSubtask && (
                <span className="text-slate-300 mr-1 select-none">
                  {"\u21B3"}
                </span>
              )}
              {item.source && item.source !== "system" && (
                <SourceIcon source={item.source} />
              )}
              {item.title}
              {(relCount > 0 || commentCount > 0) && (
                <span className="inline-flex items-center gap-1.5 ml-2">
                  {relCount > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400">
                      <Link className="size-2.5" />
                      {relCount}
                    </span>
                  )}
                  {commentCount > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400">
                      <MessageSquare className="size-2.5" />
                      {commentCount}
                    </span>
                  )}
                </span>
              )}
            </span>
          </td>
        );
      }

      case "status": {
        return (
          <td
            key={colId}
            ref={(el) => {
              cellRefs.current["status"] = el;
            }}
            className="relative px-3 py-1.5 cursor-pointer"
            onClick={(e) => handleCellClick("status", e)}
          >
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] font-medium px-1.5 py-0 rounded-md",
                statusCfg.color
              )}
            >
              {statusCfg.label}
            </Badge>
            {editingField === "status" && (
              <InlineSelectCell
                value={item.status as ItemStatus}
                options={statusOptions}
                onCommit={(val) => commitFieldEdit("status", val)}
                onCancel={cancelEdit}
                anchorRef={{ current: cellRefs.current["status"] }}
              />
            )}
          </td>
        );
      }

      case "category": {
        return (
          <td
            key={colId}
            ref={(el) => {
              cellRefs.current["category"] = el;
            }}
            className="relative px-3 py-1.5 cursor-pointer"
            onClick={(e) => handleCellClick("category", e)}
          >
            <Badge
              variant="outline"
              className="text-[10px] font-normal rounded-md border-slate-200 text-slate-600"
            >
              {categoryCfg?.label ?? item.category}
            </Badge>
            {editingField === "category" && (
              <InlineSelectCell
                value={item.category as ItemCategory}
                options={categoryOptions}
                onCommit={(val) => commitFieldEdit("category", val)}
                onCancel={cancelEdit}
                anchorRef={{ current: cellRefs.current["category"] }}
              />
            )}
          </td>
        );
      }

      case "type": {
        return (
          <td
            key={colId}
            ref={(el) => {
              cellRefs.current["type"] = el;
            }}
            className="relative px-3 py-1.5 cursor-pointer"
            onClick={(e) => handleCellClick("type", e)}
          >
            <span className="text-xs text-slate-600">{typeCfg.label}</span>
            {editingField === "type" && (
              <InlineSelectCell
                value={item.type as ItemType}
                options={typeOptions}
                onCommit={(val) => commitFieldEdit("type", val)}
                onCancel={cancelEdit}
                anchorRef={{ current: cellRefs.current["type"] }}
              />
            )}
          </td>
        );
      }

      case "due_date": {
        return (
          <td
            key={colId}
            ref={(el) => {
              cellRefs.current["due_date"] = el;
            }}
            className="relative px-3 py-1.5 cursor-pointer"
            onClick={(e) => handleCellClick("due_date", e)}
          >
            {dueDate ? (
              <div
                className={cn(
                  "flex items-center gap-1 text-xs",
                  isOverdue ? "text-red-500 font-medium" : "text-slate-600"
                )}
              >
                {isOverdue && (
                  <AlertCircle className="size-3 shrink-0" />
                )}
                {!isOverdue && (
                  <Calendar className="size-3 shrink-0 text-slate-400" />
                )}
                <span>{format(dueDate, "d MMM", { locale: ru })}</span>
              </div>
            ) : (
              <span className="text-xs text-slate-300">--</span>
            )}
            {editingField === "due_date" && (
              <InlineDateCell
                value={item.due_date ?? ""}
                onCommit={(val) => commitFieldEdit("due_date", val)}
                onCancel={cancelEdit}
                anchorRef={{ current: cellRefs.current["due_date"] }}
              />
            )}
          </td>
        );
      }

      case "subtasks": {
        return (
          <td
            key={colId}
            className="px-3 py-1.5 cursor-pointer"
            onClick={(e) => handleCellClick("subtasks", e)}
          >
            {!isSubtask && totalSubtasks > 0 ? (
              <div className="flex items-center gap-1">
                <div className="h-1 w-10 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      doneSubtasks === totalSubtasks
                        ? "bg-emerald-500"
                        : "bg-blue-500/70"
                    )}
                    style={{
                      width: `${(doneSubtasks / totalSubtasks) * 100}%`,
                    }}
                  />
                </div>
                <span className="text-[10px] text-slate-500 tabular-nums">
                  {doneSubtasks}/{totalSubtasks}
                </span>
              </div>
            ) : (
              <span className="text-xs text-slate-300">--</span>
            )}
          </td>
        );
      }

      default:
        return <td key={colId} />;
    }
  };

  /* ----- Render ----------------------------------------------------------- */

  return (
    <tr ref={setNodeRef} style={sortableStyle} className={rowCls}>
      {/* Drag handle */}
      <td
        className="px-1 py-1.5 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center size-5 rounded hover:bg-slate-200/70 transition-colors text-slate-400 cursor-grab opacity-0 group-hover:opacity-100",
            isSubtask && "ml-3"
          )}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      </td>

      {/* Expand / collapse chevron */}
      <td
        className="px-1 py-1.5 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        {showChevron ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(item.id);
            }}
            className="inline-flex items-center justify-center size-4 rounded hover:bg-slate-200/70 transition-colors text-slate-400 hover:text-slate-700"
          >
            {isExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        ) : isSubtask ? (
          <span className="inline-flex items-center justify-center text-slate-300 text-[10px] select-none" />
        ) : null}
      </td>

      {/* Checkbox */}
      <td className="px-1.5 py-1.5" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onSelect(item.id)}
          className="translate-y-[1px]"
        />
      </td>

      {/* Dynamic columns */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {visibleColumns.map((col) => renderCell(col.id))}

      {/* Empty cell for the settings column */}
      <td className="w-8" />
    </tr>
  );
}

/* -------------------------------------------------------------------------- */
/*  Empty state                                                               */
/* -------------------------------------------------------------------------- */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6">
      <div className="flex items-center justify-center size-16 rounded-2xl bg-slate-100 mb-5">
        <Inbox className="size-7 text-slate-400" />
      </div>
      <h3 className="text-base font-semibold text-slate-900 mb-1.5">
        Ничего не найдено
      </h3>
      <p className="text-sm text-slate-500 text-center max-w-[320px]">
        Нет элементов, соответствующих текущим фильтрам. Попробуйте изменить
        параметры поиска или создайте новый элемент.
      </p>
    </div>
  );
}
