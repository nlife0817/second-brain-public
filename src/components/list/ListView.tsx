"use client";

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { useFilteredItems, useBrainStore } from "@/lib/store";
import {
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  CATEGORY_CONFIG,
  TYPE_CONFIG,
  ItemWithSubtasks,
  ItemStatus,
  ItemPriority,
  ItemCategory,
  ItemType,
  SubtaskDisplayMode,
  Item,
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
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  { id: "priority", label: "Приоритет", width: "w-[100px]", sortable: true },
  { id: "title", label: "Название", width: "min-w-[220px]", sortable: true },
  { id: "status", label: "Статус", width: "w-[140px]", sortable: true },
  { id: "category", label: "Категория", width: "w-[140px]", sortable: true },
  { id: "type", label: "Тип", width: "w-[110px]", sortable: true },
  { id: "due_date", label: "Дедлайн", width: "w-[120px]", sortable: true },
  { id: "subtasks", label: "Подзадачи", width: "w-[80px]", sortable: false },
];

const DEFAULT_COLUMN_ORDER = ["priority", "title", "status", "category", "type", "due_date", "subtasks"];

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
/*  Helper: build flat row list based on subtaskDisplayMode                    */
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
  mode: SubtaskDisplayMode,
  expandedItems: Set<string>
): FlatRow[] {
  const rows: FlatRow[] = [];

  for (const item of sortedItems) {
    const totalSub = item.subtasks?.length ?? 0;
    const doneSub =
      item.subtasks?.filter((s) => s.status === "done").length ?? 0;

    rows.push({
      item,
      isSubtask: false,
      parentId: null,
      depth: 0,
      hasSubtasks: totalSub > 0,
      totalSubtasks: totalSub,
      doneSubtasks: doneSub,
    });

    if (totalSub === 0) continue;

    if (mode === "inline") {
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
    } else if (mode === "accordion") {
      if (expandedItems.has(item.id)) {
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
  }

  return rows;
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
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const allColIds = ALL_COLUMNS.map((c) => c.id);

  // Visible = those in columnOrder; hidden = those not in columnOrder (except title always visible)
  const visibleSet = new Set(columnOrder);

  const toggleColumn = (colId: string) => {
    if (colId === "title") return; // title cannot be removed
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
        className="inline-flex items-center justify-center size-7 rounded hover:bg-slate-200/70 transition-colors text-slate-400 hover:text-slate-600"
        title="Настройка колонок"
      >
        <Settings2 className="size-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-slate-200 bg-white shadow-lg p-3">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
            Колонки
          </div>

          {/* Visible columns in current order */}
          <div className="space-y-1 mb-2">
            {columnOrder.map((colId, idx) => {
              const col = colMap[colId];
              if (!col) return null;
              const isTitle = colId === "title";
              return (
                <div
                  key={colId}
                  className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-slate-50 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => toggleColumn(colId)}
                    className={cn(
                      "shrink-0",
                      isTitle ? "text-slate-300 cursor-not-allowed" : "text-blue-500 hover:text-blue-700"
                    )}
                    disabled={isTitle}
                    title={isTitle ? "Нельзя скрыть" : "Скрыть"}
                  >
                    <Eye className="size-3.5" />
                  </button>
                  <span className="flex-1 text-slate-700 truncate">{col.label}</span>
                  <button
                    type="button"
                    onClick={() => moveUp(colId)}
                    disabled={idx === 0}
                    className="text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <MoveUpIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(colId)}
                    disabled={idx === columnOrder.length - 1}
                    className="text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <MoveDownIcon className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Hidden columns */}
          {allColIds.filter((id) => !visibleSet.has(id)).length > 0 && (
            <>
              <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1 mt-3">
                Скрытые
              </div>
              <div className="space-y-1 mb-2">
                {allColIds
                  .filter((id) => !visibleSet.has(id))
                  .map((colId) => {
                    const col = colMap[colId];
                    if (!col) return null;
                    return (
                      <div
                        key={colId}
                        className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-slate-50 text-sm"
                      >
                        <button
                          type="button"
                          onClick={() => toggleColumn(colId)}
                          className="shrink-0 text-slate-400 hover:text-slate-600"
                          title="Показать"
                        >
                          <EyeOff className="size-3.5" />
                        </button>
                        <span className="flex-1 text-slate-400 truncate">{col.label}</span>
                      </div>
                    );
                  })}
              </div>
            </>
          )}

          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 mt-2 px-1.5 py-1 rounded hover:bg-slate-50 w-full"
          >
            <RotateCcw className="size-3" />
            Сбросить
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function ListView() {
  const items = useFilteredItems();
  const openDetail = useBrainStore((s) => s.openDetail);
  const subtaskDisplayMode = useBrainStore((s) => s.subtaskDisplayMode);
  const editingItemId = useBrainStore((s) => s.editingItemId);
  const editingField = useBrainStore((s) => s.editingField);
  const setEditingItem = useBrainStore((s) => s.setEditingItem);
  const updateItem = useBrainStore((s) => s.updateItem);
  const reorderItems = useBrainStore((s) => s.reorderItems);
  const listColumnOrder = useBrainStore((s) => s.listColumnOrder);
  const setListColumnOrder = useBrainStore((s) => s.setListColumnOrder);

  const [sort, setSort] = useState<SortState>({
    column: "created_at",
    direction: "desc",
  });

  const [manualOrder, setManualOrder] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  /* ----- Column definitions for current order ----------------------------- */

  const colMap = useMemo(
    () => Object.fromEntries(ALL_COLUMNS.map((c) => [c.id, c])),
    []
  );

  const visibleColumns = useMemo(
    () => listColumnOrder.map((id) => colMap[id]).filter(Boolean) as ColumnDef[],
    [listColumnOrder, colMap]
  );

  /* ----- DnD sensors ----------------------------------------------------- */

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
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
          cmp = (CATEGORY_CONFIG[a.category]?.label ?? "").localeCompare(
            CATEGORY_CONFIG[b.category]?.label ?? "",
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
  }, [items, sort, manualOrder]);

  /* ----- flat rows -------------------------------------------------------- */

  const flatRows = useMemo(
    () => buildFlatRows(sortedItems, subtaskDisplayMode, expandedItems),
    [sortedItems, subtaskDisplayMode, expandedItems]
  );

  /* ----- IDs for SortableContext (top-level only) ------------------------- */

  const topLevelIds = useMemo(
    () => flatRows.filter((r) => !r.isSubtask).map((r) => r.item.id),
    [flatRows]
  );

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
    topLevelIds.length > 0 &&
    topLevelIds.every((id) => selectedIds.has(id));

  const someSelected =
    selectedIds.size > 0 && !allSelected;

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

  /* ----- DnD drag end handler -------------------------------------------- */

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over || active.id === over.id) return;

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
    [topLevelIds, sortedItems, reorderItems]
  );

  /* ----- render ----------------------------------------------------------- */

  if (items.length === 0) {
    return <EmptyState />;
  }

  return (
    <ScrollArea className="h-full w-full">
      <div className="min-w-[900px]">
        <table className="w-full border-collapse bg-white border border-slate-200 rounded-lg overflow-hidden">
          {/* ---- Header --------------------------------------------------- */}
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 border-b border-slate-200">
              {/* Drag handle column header */}
              <th className="w-8 px-1 py-3 text-left" />

              {/* Expand toggle */}
              <th className="w-10 px-2 py-3 text-left" />

              {/* Checkbox */}
              <th className="w-10 px-2 py-3 text-left">
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
                      "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500"
                    )}
                  >
                    {col.label}
                  </th>
                )
              )}

              {/* Column config button */}
              <th className="w-10 px-1 py-3">
                <ColumnConfigPopover
                  columnOrder={listColumnOrder}
                  onOrderChange={setListColumnOrder}
                />
              </th>
            </tr>
          </thead>

          {/* ---- Body ----------------------------------------------------- */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={topLevelIds}
              strategy={verticalListSortingStrategy}
            >
              <tbody className="divide-y divide-slate-100">
                {flatRows.map((row) => (
                  <ItemRow
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
                    subtaskDisplayMode={subtaskDisplayMode}
                    isExpanded={expandedItems.has(row.item.id)}
                    onToggleExpand={toggleExpanded}
                    visibleColumns={visibleColumns}
                  />
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
        </table>
      </div>
    </ScrollArea>
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
    <th className={cn("px-4 py-3 text-left", className)}>
      <button
        type="button"
        onClick={() => onToggle(column)}
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider transition-colors",
          isActive
            ? "text-slate-900"
            : "text-slate-500 hover:text-slate-900"
        )}
      >
        {label}
        {isActive ? (
          current.direction === "asc" ? (
            <ArrowUp className="size-3.5" />
          ) : (
            <ArrowDown className="size-3.5" />
          )
        ) : (
          <ArrowUpDown className="size-3.5 opacity-40" />
        )}
      </button>
    </th>
  );
}

/* -------------------------------------------------------------------------- */
/*  Inline edit cell for select fields                                        */
/* -------------------------------------------------------------------------- */

function InlineSelectCell<T extends string>({
  value,
  options,
  onCommit,
  onCancel,
}: {
  value: T;
  options: { key: T; label: string }[];
  onCommit: (val: T) => void;
  onCancel: () => void;
}) {
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const el = selectRef.current;
    if (el) {
      el.focus();
      // Try to auto-open the select dropdown
      el.showPicker?.();
    }
  }, []);

  return (
    <select
      ref={selectRef}
      value={value}
      onChange={(e) => onCommit(e.target.value as T)}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs text-slate-700 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300"
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((opt) => (
        <option key={opt.key} value={opt.key}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/* -------------------------------------------------------------------------- */
/*  Inline edit cell for date field                                           */
/* -------------------------------------------------------------------------- */

function InlineDateCell({
  value,
  onCommit,
  onCancel,
}: {
  value: string;
  onCommit: (val: string | null) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.showPicker?.();
    }
  }, []);

  return (
    <input
      ref={inputRef}
      type="date"
      value={value}
      onChange={(e) => onCommit(e.target.value || null)}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300"
      onClick={(e) => e.stopPropagation()}
    />
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
  subtaskDisplayMode,
  isExpanded,
  onToggleExpand,
  visibleColumns,
}: {
  row: FlatRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  editingField: string | null;
  setEditingItem: (id: string | null, field?: string | null) => void;
  updateItem: (id: string, payload: Record<string, unknown>) => Promise<void>;
  subtaskDisplayMode: SubtaskDisplayMode;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  visibleColumns: ColumnDef[];
}) {
  const { item, isSubtask, hasSubtasks, totalSubtasks, doneSubtasks } = row;

  /* ----- DnD sortable (only top-level items) ----------------------------- */

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    disabled: isSubtask,
    animateLayoutChanges: () => false,
  });

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const statusCfg = STATUS_CONFIG[item.status as ItemStatus];
  const priorityCfg = PRIORITY_CONFIG[item.priority as ItemPriority];
  const categoryCfg = CATEGORY_CONFIG[item.category as ItemCategory];
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

  const showChevron =
    subtaskDisplayMode === "accordion" && hasSubtasks && !isSubtask;

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

  /* ----- Select option builders ------------------------------------------ */

  const statusOptions = useMemo(
    () =>
      (Object.entries(STATUS_CONFIG) as [ItemStatus, (typeof STATUS_CONFIG)[ItemStatus]][]).map(
        ([key, cfg]) => ({ key, label: cfg.label })
      ),
    []
  );

  const priorityOptions = useMemo(
    () =>
      (Object.entries(PRIORITY_CONFIG) as [ItemPriority, (typeof PRIORITY_CONFIG)[ItemPriority]][]).map(
        ([key, cfg]) => ({ key, label: `${cfg.icon} ${cfg.label}` })
      ),
    []
  );

  const categoryOptions = useMemo(
    () =>
      (Object.entries(CATEGORY_CONFIG) as [ItemCategory, (typeof CATEGORY_CONFIG)[ItemCategory]][]).map(
        ([key, cfg]) => ({ key, label: cfg.label })
      ),
    []
  );

  const typeOptions = useMemo(
    () =>
      (Object.entries(TYPE_CONFIG) as [ItemType, (typeof TYPE_CONFIG)[ItemType]][]).map(
        ([key, cfg]) => ({ key, label: cfg.label })
      ),
    []
  );

  /* ----- Render a cell by column id --------------------------------------- */

  const renderCell = (colId: string) => {
    switch (colId) {
      case "priority": {
        if (editingField === "priority") {
          return (
            <td key={colId} className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
              <InlineSelectCell
                value={item.priority as ItemPriority}
                options={priorityOptions}
                onCommit={(val) => commitFieldEdit("priority", val)}
                onCancel={cancelEdit}
              />
            </td>
          );
        }
        return (
          <td
            key={colId}
            className="px-4 py-3 cursor-pointer"
            onClick={(e) => handleCellClick("priority", e)}
          >
            {isSubtask ? (
              <span className="text-slate-300" />
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-sm leading-none">{priorityCfg.icon}</span>
              </div>
            )}
          </td>
        );
      }

      case "title": {
        return (
          <td
            key={colId}
            className="px-4 py-3 cursor-pointer"
            onClick={(e) => handleCellClick("title", e)}
          >
            <div className="flex flex-col gap-0.5">
              <span
                className={cn(
                  "text-sm font-medium leading-snug line-clamp-1 transition-colors",
                  isSubtask
                    ? "text-slate-600 pl-4"
                    : "text-slate-900 group-hover:text-blue-600"
                )}
              >
                {isSubtask && (
                  <span className="text-slate-300 mr-1.5 select-none">{"\u21B3"}</span>
                )}
                {item.title}
              </span>
              {!isSubtask && "description" in item && (item as ItemWithSubtasks).description && (
                <span className="text-xs text-slate-400 line-clamp-1 max-w-[320px]">
                  {(item as ItemWithSubtasks).description}
                </span>
              )}
            </div>
          </td>
        );
      }

      case "status": {
        if (editingField === "status") {
          return (
            <td key={colId} className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
              <InlineSelectCell
                value={item.status as ItemStatus}
                options={statusOptions}
                onCommit={(val) => commitFieldEdit("status", val)}
                onCancel={cancelEdit}
              />
            </td>
          );
        }
        return (
          <td
            key={colId}
            className="px-4 py-3 cursor-pointer"
            onClick={(e) => handleCellClick("status", e)}
          >
            <Badge
              variant="secondary"
              className={cn(
                "text-[11px] font-medium px-2 py-0.5 rounded-md",
                statusCfg.color
              )}
            >
              {statusCfg.label}
            </Badge>
          </td>
        );
      }

      case "category": {
        if (editingField === "category") {
          return (
            <td key={colId} className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
              <InlineSelectCell
                value={item.category as ItemCategory}
                options={categoryOptions}
                onCommit={(val) => commitFieldEdit("category", val)}
                onCancel={cancelEdit}
              />
            </td>
          );
        }
        return (
          <td
            key={colId}
            className="px-4 py-3 cursor-pointer"
            onClick={(e) => handleCellClick("category", e)}
          >
            <Badge
              variant="outline"
              className="text-[11px] font-normal rounded-md border-slate-200 text-slate-600"
            >
              {categoryCfg.label}
            </Badge>
          </td>
        );
      }

      case "type": {
        if (editingField === "type") {
          return (
            <td key={colId} className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
              <InlineSelectCell
                value={item.type as ItemType}
                options={typeOptions}
                onCommit={(val) => commitFieldEdit("type", val)}
                onCancel={cancelEdit}
              />
            </td>
          );
        }
        return (
          <td
            key={colId}
            className="px-4 py-3 cursor-pointer"
            onClick={(e) => handleCellClick("type", e)}
          >
            <span className="text-sm text-slate-600">{typeCfg.label}</span>
          </td>
        );
      }

      case "due_date": {
        if (editingField === "due_date") {
          return (
            <td key={colId} className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
              <InlineDateCell
                value={item.due_date ?? ""}
                onCommit={(val) => commitFieldEdit("due_date", val)}
                onCancel={cancelEdit}
              />
            </td>
          );
        }
        return (
          <td
            key={colId}
            className="px-4 py-3 cursor-pointer"
            onClick={(e) => handleCellClick("due_date", e)}
          >
            {dueDate ? (
              <div
                className={cn(
                  "flex items-center gap-1.5 text-sm",
                  isOverdue
                    ? "text-red-500 font-medium"
                    : "text-slate-600"
                )}
              >
                {isOverdue && (
                  <AlertCircle className="size-3.5 shrink-0" />
                )}
                {!isOverdue && (
                  <Calendar className="size-3.5 shrink-0 text-slate-400" />
                )}
                <span>{format(dueDate, "d MMM", { locale: ru })}</span>
              </div>
            ) : (
              <span className="text-sm text-slate-300">--</span>
            )}
          </td>
        );
      }

      case "subtasks": {
        return (
          <td
            key={colId}
            className="px-4 py-3 cursor-pointer"
            onClick={(e) => handleCellClick("subtasks", e)}
          >
            {!isSubtask && totalSubtasks > 0 ? (
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-12 rounded-full bg-slate-200 overflow-hidden">
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
                <span className="text-xs text-slate-500 tabular-nums">
                  {doneSubtasks}/{totalSubtasks}
                </span>
              </div>
            ) : (
              <span className="text-sm text-slate-300">--</span>
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
    <tr
      ref={setNodeRef}
      style={sortableStyle}
      className={rowCls}
    >
      {/* Drag handle */}
      <td
        className="px-1 py-3 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        {!isSubtask && (
          <button
            type="button"
            className="inline-flex items-center justify-center size-6 rounded hover:bg-slate-200/70 transition-colors text-slate-400 cursor-grab opacity-0 group-hover:opacity-100"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        )}
      </td>

      {/* Expand / collapse chevron */}
      <td
        className="px-2 py-3 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        {showChevron ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(item.id);
            }}
            className="inline-flex items-center justify-center size-5 rounded hover:bg-slate-200/70 transition-colors text-slate-400 hover:text-slate-700"
          >
            {isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        ) : isSubtask ? (
          <span className="inline-flex items-center justify-center text-slate-300 text-xs select-none">

          </span>
        ) : null}
      </td>

      {/* Checkbox */}
      <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onSelect(item.id)}
          className="translate-y-[1px]"
        />
      </td>

      {/* Dynamic columns */}
      {visibleColumns.map((col) => renderCell(col.id))}

      {/* Empty cell for the settings column */}
      <td className="w-10" />
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
