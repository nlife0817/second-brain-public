"use client";

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  type KeyboardEvent,
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

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

    // Parent row
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
      // Always show subtasks inline
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
      // Only show subtasks if parent is expanded
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
    // "detached" mode: subtasks appear as their own top-level items if they
    // match filters -- they're already in `sortedItems` if the store returns them.
    // We just don't nest them under the parent.
  }

  return rows;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function ListView() {
  const items = useFilteredItems();
  const openDetail = useBrainStore((s) => s.openDetail);
  const subtaskDisplayMode = useBrainStore((s) => s.subtaskDisplayMode);
  const editingItemId = useBrainStore((s) => s.editingItemId);
  const setEditingItem = useBrainStore((s) => s.setEditingItem);
  const updateItem = useBrainStore((s) => s.updateItem);

  const [sort, setSort] = useState<SortState>({
    column: "created_at",
    direction: "desc",
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  /* ----- sorting ---------------------------------------------------------- */

  const sortedItems = useMemo(() => {
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
  }, [items, sort]);

  /* ----- flat rows -------------------------------------------------------- */

  const flatRows = useMemo(
    () => buildFlatRows(sortedItems, subtaskDisplayMode, expandedItems),
    [sortedItems, subtaskDisplayMode, expandedItems]
  );

  /* ----- column toggle ---------------------------------------------------- */

  const toggleSort = useCallback((column: SortColumn) => {
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

  const topLevelIds = useMemo(
    () => flatRows.filter((r) => !r.isSubtask).map((r) => r.item.id),
    [flatRows]
  );

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

  /* ----- inline editing handlers ----------------------------------------- */

  const handleDoubleClick = useCallback(
    (id: string) => {
      setEditingItem(id);
    },
    [setEditingItem]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingItem(null);
  }, [setEditingItem]);

  const handleSaveEdit = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      await updateItem(id, payload);
      setEditingItem(null);
    },
    [updateItem, setEditingItem]
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

              {/* Priority */}
              <SortableHeader
                label="Приоритет"
                column="priority"
                current={sort}
                onToggle={toggleSort}
                className="w-[100px]"
              />
              <SortableHeader
                label="Название"
                column="title"
                current={sort}
                onToggle={toggleSort}
                className="min-w-[220px]"
              />
              <SortableHeader
                label="Статус"
                column="status"
                current={sort}
                onToggle={toggleSort}
                className="w-[140px]"
              />
              <SortableHeader
                label="Категория"
                column="category"
                current={sort}
                onToggle={toggleSort}
                className="w-[140px]"
              />
              <SortableHeader
                label="Тип"
                column="type"
                current={sort}
                onToggle={toggleSort}
                className="w-[110px]"
              />
              <SortableHeader
                label="Срок"
                column="due_date"
                current={sort}
                onToggle={toggleSort}
                className="w-[120px]"
              />
              {/* Subtasks - not sortable */}
              <th className="w-[80px] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Подзадачи
              </th>
            </tr>
          </thead>

          {/* ---- Body ----------------------------------------------------- */}
          <tbody className="divide-y divide-slate-100">
            {flatRows.map((row) => (
              <ItemRow
                key={`${row.parentId ?? "root"}-${row.item.id}`}
                row={row}
                selected={selectedIds.has(row.item.id)}
                onSelect={toggleOne}
                onOpen={openDetail}
                isEditing={editingItemId === row.item.id}
                onDoubleClick={handleDoubleClick}
                onCancelEdit={handleCancelEdit}
                onSaveEdit={handleSaveEdit}
                subtaskDisplayMode={subtaskDisplayMode}
                isExpanded={expandedItems.has(row.item.id)}
                onToggleExpand={toggleExpanded}
              />
            ))}
          </tbody>
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
}: {
  label: string;
  column: SortColumn;
  current: SortState;
  onToggle: (col: SortColumn) => void;
  className?: string;
}) {
  const isActive = current.column === column;

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
/*  Table row                                                                 */
/* -------------------------------------------------------------------------- */

function ItemRow({
  row,
  selected,
  onSelect,
  onOpen,
  isEditing,
  onDoubleClick,
  onCancelEdit,
  onSaveEdit,
  subtaskDisplayMode,
  isExpanded,
  onToggleExpand,
}: {
  row: FlatRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  isEditing: boolean;
  onDoubleClick: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, payload: Record<string, unknown>) => void;
  subtaskDisplayMode: SubtaskDisplayMode;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
}) {
  const { item, isSubtask, hasSubtasks, totalSubtasks, doneSubtasks } = row;

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

  /* ----- Inline editing local state --------------------------------------- */

  const [editTitle, setEditTitle] = useState(item.title);
  const [editStatus, setEditStatus] = useState(item.status);
  const [editPriority, setEditPriority] = useState(item.priority);
  const [editCategory, setEditCategory] = useState(item.category);
  const [editType, setEditType] = useState(item.type);
  const [editDueDate, setEditDueDate] = useState(item.due_date ?? "");
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Reset local state when editing starts
  useEffect(() => {
    if (isEditing) {
      setEditTitle(item.title);
      setEditStatus(item.status);
      setEditPriority(item.priority);
      setEditCategory(item.category);
      setEditType(item.type);
      setEditDueDate(item.due_date ?? "");
      // Focus the title input after a tick
      setTimeout(() => titleInputRef.current?.focus(), 0);
    }
  }, [isEditing, item]);

  const commitEdit = useCallback(() => {
    const payload: Record<string, unknown> = {};
    if (editTitle !== item.title) payload.title = editTitle;
    if (editStatus !== item.status) payload.status = editStatus;
    if (editPriority !== item.priority) payload.priority = editPriority;
    if (editCategory !== item.category) payload.category = editCategory;
    if (editType !== item.type) payload.type = editType;
    const newDue = editDueDate || null;
    if (newDue !== item.due_date) payload.due_date = newDue;

    if (Object.keys(payload).length > 0) {
      onSaveEdit(item.id, payload);
    } else {
      onCancelEdit();
    }
  }, [
    editTitle,
    editStatus,
    editPriority,
    editCategory,
    editType,
    editDueDate,
    item,
    onSaveEdit,
    onCancelEdit,
  ]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancelEdit();
      }
    },
    [commitEdit, onCancelEdit]
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
    isEditing && "ring-1 ring-inset ring-blue-300 bg-blue-50/30"
  );

  /* ----- Render: EDITING mode --------------------------------------------- */

  if (isEditing) {
    return (
      <tr className={rowCls} onKeyDown={handleKeyDown}>
        {/* Expand */}
        <td className="px-2 py-2" />
        {/* Checkbox */}
        <td className="px-2 py-2">
          <Checkbox
            checked={selected}
            onCheckedChange={() => onSelect(item.id)}
            className="translate-y-[1px]"
          />
        </td>

        {/* Priority select */}
        <td className="px-3 py-2">
          <Select
            value={editPriority}
            onValueChange={(v) => v && setEditPriority(v as ItemPriority)}
          >
            <SelectTrigger size="sm" className="w-auto min-w-[90px] h-7 text-xs">
              <SelectValue>
                {PRIORITY_CONFIG[editPriority as ItemPriority]?.icon}{" "}
                {PRIORITY_CONFIG[editPriority as ItemPriority]?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(
                Object.entries(PRIORITY_CONFIG) as [
                  ItemPriority,
                  (typeof PRIORITY_CONFIG)[ItemPriority],
                ][]
              ).map(([key, cfg]) => (
                <SelectItem key={key} value={key}>
                  <span className="inline-flex items-center gap-1.5">
                    <span>{cfg.icon}</span>
                    <span>{cfg.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>

        {/* Title input */}
        <td className="px-3 py-2">
          <Input
            ref={titleInputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={commitEdit}
            className="h-7 text-sm text-slate-900"
            placeholder="Название..."
          />
        </td>

        {/* Status select */}
        <td className="px-3 py-2">
          <Select
            value={editStatus}
            onValueChange={(v) => v && setEditStatus(v as ItemStatus)}
          >
            <SelectTrigger size="sm" className="w-auto min-w-[110px] h-7 text-xs">
              <SelectValue>
                {STATUS_CONFIG[editStatus as ItemStatus]?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(
                Object.entries(STATUS_CONFIG) as [
                  ItemStatus,
                  (typeof STATUS_CONFIG)[ItemStatus],
                ][]
              ).map(([key, cfg]) => (
                <SelectItem key={key} value={key}>
                  {cfg.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>

        {/* Category select */}
        <td className="px-3 py-2">
          <Select
            value={editCategory}
            onValueChange={(v) => v && setEditCategory(v as ItemCategory)}
          >
            <SelectTrigger size="sm" className="w-auto min-w-[100px] h-7 text-xs">
              <SelectValue>
                {CATEGORY_CONFIG[editCategory as ItemCategory]?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(
                Object.entries(CATEGORY_CONFIG) as [
                  ItemCategory,
                  (typeof CATEGORY_CONFIG)[ItemCategory],
                ][]
              ).map(([key, cfg]) => (
                <SelectItem key={key} value={key}>
                  {cfg.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>

        {/* Type select */}
        <td className="px-3 py-2">
          <Select
            value={editType}
            onValueChange={(v) => v && setEditType(v as ItemType)}
          >
            <SelectTrigger size="sm" className="w-auto min-w-[90px] h-7 text-xs">
              <SelectValue>
                {TYPE_CONFIG[editType as ItemType]?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(
                Object.entries(TYPE_CONFIG) as [
                  ItemType,
                  (typeof TYPE_CONFIG)[ItemType],
                ][]
              ).map(([key, cfg]) => (
                <SelectItem key={key} value={key}>
                  {cfg.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>

        {/* Due date input */}
        <td className="px-3 py-2">
          <input
            type="date"
            value={editDueDate}
            onChange={(e) => setEditDueDate(e.target.value)}
            className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300"
          />
        </td>

        {/* Subtasks - read only in edit mode */}
        <td className="px-4 py-2">
          {totalSubtasks > 0 ? (
            <span className="text-xs text-slate-500 tabular-nums">
              {doneSubtasks}/{totalSubtasks}
            </span>
          ) : (
            <span className="text-xs text-slate-300">--</span>
          )}
        </td>
      </tr>
    );
  }

  /* ----- Render: DISPLAY mode --------------------------------------------- */

  return (
    <tr
      className={cn(rowCls, !isEditing && "cursor-pointer")}
      onDoubleClick={() => onDoubleClick(item.id)}
    >
      {/* Expand / collapse chevron */}
      <td className="px-2 py-3 text-center">
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
          /* Tree line indicator for subtask rows */
          <span className="inline-flex items-center justify-center text-slate-300 text-xs select-none">

          </span>
        ) : null}
      </td>

      {/* Checkbox */}
      <td className="px-2 py-3">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onSelect(item.id)}
          className="translate-y-[1px]"
        />
      </td>

      {/* Priority */}
      <td className="px-4 py-3" onClick={() => onOpen(item.id)}>
        {isSubtask ? (
          <span className="text-slate-300" />
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-sm leading-none">{priorityCfg.icon}</span>
          </div>
        )}
      </td>

      {/* Title */}
      <td className="px-4 py-3" onClick={() => onOpen(item.id)}>
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

      {/* Status */}
      <td className="px-4 py-3" onClick={() => onOpen(item.id)}>
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

      {/* Category */}
      <td className="px-4 py-3" onClick={() => onOpen(item.id)}>
        <Badge
          variant="outline"
          className="text-[11px] font-normal rounded-md border-slate-200 text-slate-600"
        >
          {categoryCfg.label}
        </Badge>
      </td>

      {/* Type */}
      <td className="px-4 py-3" onClick={() => onOpen(item.id)}>
        <span className="text-sm text-slate-600">{typeCfg.label}</span>
      </td>

      {/* Due date */}
      <td className="px-4 py-3" onClick={() => onOpen(item.id)}>
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

      {/* Subtasks */}
      <td className="px-4 py-3" onClick={() => onOpen(item.id)}>
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
