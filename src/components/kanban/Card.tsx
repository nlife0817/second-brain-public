"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ItemWithSubtasks,
  ItemStatus,
  ItemPriority,
  ItemCategory,
  PRIORITY_CONFIG,
  CATEGORY_CONFIG,
  STATUS_CONFIG,
  TYPE_CONFIG,
  KANBAN_COLUMNS,
} from "@/types";
import { useBrainStore } from "@/lib/store";
import { format, isPast, isToday } from "date-fns";
import { ru } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  CheckSquare,
  GripVertical,
  StickyNote,
  Users,
  Map,
  Lightbulb,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface KanbanCardProps {
  item: ItemWithSubtasks;
  isDragOverlay?: boolean;
}

const typeIcons: Record<string, React.ElementType> = {
  CheckSquare,
  StickyNote,
  Calendar,
  Map,
  Lightbulb,
  Users,
};

/* ------------------------------------------------------------------ */
/*  Inline Edit sub-component                                         */
/* ------------------------------------------------------------------ */

interface InlineEditProps {
  item: ItemWithSubtasks;
  onDone: () => void;
}

function InlineEdit({ item, onDone }: InlineEditProps) {
  const updateItem = useBrainStore((s) => s.updateItem);

  const [title, setTitle] = useState(item.title);
  const [status, setStatus] = useState<ItemStatus>(item.status);
  const [priority, setPriority] = useState<ItemPriority>(item.priority);
  const [category, setCategory] = useState<ItemCategory>(item.category);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus on mount
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        handleSave();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, status, priority, category]);

  const handleSave = useCallback(async () => {
    const changes: Record<string, string> = {};
    if (title.trim() && title !== item.title) changes.title = title.trim();
    if (status !== item.status) changes.status = status;
    if (priority !== item.priority) changes.priority = priority;
    if (category !== item.category) changes.category = category;

    if (Object.keys(changes).length > 0) {
      await updateItem(item.id, changes);
    }
    onDone();
  }, [title, status, priority, category, item, updateItem, onDone]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onDone();
    }
  };

  const selectClass =
    "h-6 rounded-md border border-slate-200 bg-white px-1.5 text-[11px] text-slate-600 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30";

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-2"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Editable title */}
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[13px] font-medium text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30"
      />

      {/* Dropdowns row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Status */}
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ItemStatus)}
          className={selectClass}
        >
          {KANBAN_COLUMNS.map((s) => (
            <option key={s} value={s}>
              {STATUS_CONFIG[s].label}
            </option>
          ))}
        </select>

        {/* Priority */}
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as ItemPriority)}
          className={selectClass}
        >
          {(Object.keys(PRIORITY_CONFIG) as ItemPriority[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_CONFIG[p].label}
            </option>
          ))}
        </select>

        {/* Category */}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ItemCategory)}
          className={selectClass}
        >
          {(Object.keys(CATEGORY_CONFIG) as ItemCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_CONFIG[c].label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Subtask renderers per display mode                                */
/* ------------------------------------------------------------------ */

function SubtasksInline({
  subtasks,
  completed,
  total,
}: {
  subtasks: ItemWithSubtasks["subtasks"];
  completed: number;
  total: number;
}) {
  const updateItem = useBrainStore((s) => s.updateItem);

  return (
    <div className="mt-2 space-y-1">
      {/* Progress bar */}
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              completed === total ? "bg-emerald-500" : "bg-blue-500/70"
            )}
            style={{ width: `${(completed / total) * 100}%` }}
          />
        </div>
        <span className="text-[10px] font-medium text-slate-400 tabular-nums">
          {completed}/{total}
        </span>
      </div>

      {/* Individual subtask checkboxes */}
      <div className="space-y-0.5">
        {subtasks.map((st) => (
          <label
            key={st.id}
            className="flex items-center gap-1.5 cursor-pointer group/st"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={st.status === "done"}
              onChange={() =>
                updateItem(st.id, {
                  status: st.status === "done" ? "todo" : "done",
                })
              }
              className="size-3 rounded border-slate-300 text-blue-500 accent-blue-500"
            />
            <span
              className={cn(
                "text-[11px] leading-tight",
                st.status === "done"
                  ? "text-slate-400 line-through"
                  : "text-slate-600"
              )}
            >
              {st.title}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SubtasksAccordion({
  subtasks,
  completed,
  total,
}: {
  subtasks: ItemWithSubtasks["subtasks"];
  completed: number;
  total: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const updateItem = useBrainStore((s) => s.updateItem);

  return (
    <div className="mt-2">
      {/* Collapsible header */}
      <button
        type="button"
        className="flex w-full items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {expanded ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        <span>
          Subtasks {completed}/{total}
        </span>
        {/* Small progress indicator */}
        <div className="flex-1 h-1 rounded-full bg-slate-100 ml-1 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              completed === total ? "bg-emerald-500" : "bg-blue-500/70"
            )}
            style={{ width: `${(completed / total) * 100}%` }}
          />
        </div>
      </button>

      {/* Expanded subtask list */}
      {expanded && (
        <div className="mt-1 space-y-0.5 pl-4 border-l border-slate-200">
          {subtasks.map((st) => (
            <label
              key={st.id}
              className="flex items-center gap-1.5 cursor-pointer"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={st.status === "done"}
                onChange={() =>
                  updateItem(st.id, {
                    status: st.status === "done" ? "todo" : "done",
                  })
                }
                className="size-3 rounded border-slate-300 text-blue-500 accent-blue-500"
              />
              <span
                className={cn(
                  "text-[11px] leading-tight",
                  st.status === "done"
                    ? "text-slate-400 line-through"
                    : "text-slate-600"
                )}
              >
                {st.title}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function SubtasksProgressOnly({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  // Detached mode: no subtask details shown on the card, just a minimal counter
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            completed === total ? "bg-emerald-500" : "bg-blue-500/70"
          )}
          style={{ width: `${(completed / total) * 100}%` }}
        />
      </div>
      <span className="text-[10px] font-medium text-slate-400 tabular-nums">
        {completed}/{total}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main KanbanCard                                                   */
/* ------------------------------------------------------------------ */

export function KanbanCard({ item, isDragOverlay = false }: KanbanCardProps) {
  const openDetail = useBrainStore((s) => s.openDetail);
  const editingItemId = useBrainStore((s) => s.editingItemId);
  const setEditingItem = useBrainStore((s) => s.setEditingItem);
  const subtaskDisplayMode = useBrainStore((s) => s.subtaskDisplayMode);

  const isEditing = editingItemId === item.id;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: {
      type: "item",
      item,
    },
    disabled: isEditing,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const priorityConfig = PRIORITY_CONFIG[item.priority];
  const categoryConfig = CATEGORY_CONFIG[item.category];
  const typeConfig = TYPE_CONFIG[item.type];

  const completedSubtasks = item.subtasks.filter(
    (s) => s.status === "done"
  ).length;
  const totalSubtasks = item.subtasks.length;

  const dueDate = item.due_date ? new Date(item.due_date) : null;
  const isOverdue =
    dueDate && isPast(dueDate) && !isToday(dueDate) && item.status !== "done";
  const isDueToday = dueDate && isToday(dueDate);

  const TypeIcon = typeIcons[typeConfig.icon] ?? CheckSquare;

  // Click timer for distinguishing single vs double click
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't handle clicks when in edit mode
      if (isEditing) return;

      if (clickTimer.current) {
        // Second click within the window -- it's a double-click
        clearTimeout(clickTimer.current);
        clickTimer.current = null;
        setEditingItem(item.id);
      } else {
        // First click -- wait to see if a second arrives
        clickTimer.current = setTimeout(() => {
          clickTimer.current = null;
          openDetail(item.id);
        }, 250);
      }
    },
    [isEditing, item.id, openDetail, setEditingItem]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/card relative rounded-xl border bg-white p-3 shadow-sm",
        "border-slate-200",
        "transition-all duration-200 ease-out",
        "hover:shadow-md hover:border-slate-300 hover:-translate-y-0.5",
        isDragging && !isDragOverlay && "opacity-40 shadow-none scale-[0.98]",
        isDragOverlay &&
          "shadow-2xl shadow-black/10 border-slate-300 ring-1 ring-black/5 rotate-[2deg] scale-105",
        isEditing && "ring-2 ring-blue-400/50 border-blue-300",
        "cursor-pointer"
      )}
      onClick={handleClick}
    >
      {/* Drag handle */}
      {!isEditing && (
        <div
          className={cn(
            "absolute -left-0.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150",
            "group-hover/card:opacity-40 hover:!opacity-80"
          )}
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="size-3.5 text-slate-400" />
        </div>
      )}

      {isEditing ? (
        /* ---- Inline edit mode ---- */
        <InlineEdit item={item} onDone={() => setEditingItem(null)} />
      ) : (
        /* ---- Normal display mode ---- */
        <>
          {/* Row 1: Priority dot + Title */}
          <div className="flex items-start gap-2">
            {/* Priority indicator */}
            <span
              className={cn(
                "mt-1 block size-2 shrink-0 rounded-full",
                item.priority === "urgent" &&
                  "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]",
                item.priority === "high" &&
                  "bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.3)]",
                item.priority === "medium" && "bg-yellow-500",
                item.priority === "low" && "bg-blue-400",
                item.priority === "none" && "bg-slate-300"
              )}
              title={priorityConfig.label}
            />

            <span className="flex-1 text-[13px] font-medium leading-snug text-slate-800 line-clamp-2">
              {item.title}
            </span>

            {/* Type icon */}
            <TypeIcon className="mt-0.5 size-3.5 shrink-0 text-slate-300" />
          </div>

          {/* Row 2: Category badge + Due date */}
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <Badge
              variant="secondary"
              className="h-[18px] px-1.5 text-[10px] font-medium rounded-md bg-slate-100 text-slate-600 border-0"
            >
              {categoryConfig.label}
            </Badge>

            {dueDate && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-[10px] font-medium",
                  isOverdue && "text-red-500",
                  isDueToday && "text-amber-600",
                  !isOverdue && !isDueToday && "text-slate-400"
                )}
              >
                <Calendar className="size-2.5" />
                {format(dueDate, "d MMM", { locale: ru })}
              </span>
            )}
          </div>

          {/* Row 3: Subtasks based on display mode */}
          {totalSubtasks > 0 && subtaskDisplayMode === "inline" && (
            <SubtasksInline
              subtasks={item.subtasks}
              completed={completedSubtasks}
              total={totalSubtasks}
            />
          )}

          {totalSubtasks > 0 && subtaskDisplayMode === "accordion" && (
            <SubtasksAccordion
              subtasks={item.subtasks}
              completed={completedSubtasks}
              total={totalSubtasks}
            />
          )}

          {totalSubtasks > 0 && subtaskDisplayMode === "detached" && (
            <SubtasksProgressOnly
              completed={completedSubtasks}
              total={totalSubtasks}
            />
          )}
        </>
      )}
    </div>
  );
}
