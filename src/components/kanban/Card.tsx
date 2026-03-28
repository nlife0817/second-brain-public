"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ItemWithSubtasks,
  ItemStatus,
  ItemPriority,
  ItemCategory,
  ItemType,
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
/*  Inline Field Editor                                               */
/* ------------------------------------------------------------------ */

interface InlineFieldEditorProps {
  item: ItemWithSubtasks;
  field: string;
}

function InlineFieldEditor({ item, field }: InlineFieldEditorProps) {
  const updateItem = useBrainStore((s) => s.updateItem);
  const setEditingItem = useBrainStore((s) => s.setEditingItem);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectClass =
    "h-6 rounded-md border border-slate-200 bg-white px-1.5 text-[11px] text-slate-600 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30";

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setEditingItem(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [setEditingItem]);

  // Escape key handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setEditingItem(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setEditingItem]);

  const handleChange = useCallback(
    async (value: string) => {
      await updateItem(item.id, { [field]: value });
      setEditingItem(null);
    },
    [updateItem, item.id, field, setEditingItem]
  );

  if (field === "priority") {
    return (
      <div
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
      >
        <select
          autoFocus
          value={item.priority}
          onChange={(e) => handleChange(e.target.value)}
          className={selectClass}
        >
          {(Object.keys(PRIORITY_CONFIG) as ItemPriority[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_CONFIG[p].label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field === "status") {
    return (
      <div
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
      >
        <select
          autoFocus
          value={item.status}
          onChange={(e) => handleChange(e.target.value)}
          className={selectClass}
        >
          {KANBAN_COLUMNS.map((s) => (
            <option key={s} value={s}>
              {STATUS_CONFIG[s].label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field === "category") {
    return (
      <div
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
      >
        <select
          autoFocus
          value={item.category}
          onChange={(e) => handleChange(e.target.value)}
          className={selectClass}
        >
          {(Object.keys(CATEGORY_CONFIG) as ItemCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_CONFIG[c].label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field === "type") {
    return (
      <div
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
      >
        <select
          autoFocus
          value={item.type}
          onChange={(e) => handleChange(e.target.value)}
          className={selectClass}
        >
          {(Object.keys(TYPE_CONFIG) as ItemType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_CONFIG[t].label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field === "due_date") {
    return (
      <div
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="date"
          autoFocus
          defaultValue={item.due_date ?? ""}
          onChange={(e) => handleChange(e.target.value || "")}
          onBlur={() => setEditingItem(null)}
          className="h-6 rounded-md border border-slate-200 bg-white px-1.5 text-[11px] text-slate-600 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30"
        />
      </div>
    );
  }

  return null;
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
  const editingField = useBrainStore((s) => s.editingField);
  const setEditingItem = useBrainStore((s) => s.setEditingItem);
  const subtaskDisplayMode = useBrainStore((s) => s.subtaskDisplayMode);
  const cardVisibleFields = useBrainStore((s) => s.cardVisibleFields);

  const isEditingThis = editingItemId === item.id;

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
    disabled: isEditingThis,
    animateLayoutChanges: () => false,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
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

  const showPriority = cardVisibleFields.includes("priority");
  const showCategory = cardVisibleFields.includes("category");
  const showDueDate = cardVisibleFields.includes("due_date");
  const showSubtasks = cardVisibleFields.includes("subtasks");
  const showType = cardVisibleFields.includes("type");

  /* ---- Click handler for card background ---- */
  const handleCardClick = useCallback(() => {
    if (isEditingThis) return;
    openDetail(item.id);
  }, [isEditingThis, item.id, openDetail]);

  /* ---- Field click handlers ---- */
  const handleFieldClick = useCallback(
    (e: React.MouseEvent, field: string) => {
      e.stopPropagation();
      setEditingItem(item.id, field);
    },
    [item.id, setEditingItem]
  );

  const handleTitleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      openDetail(item.id);
    },
    [item.id, openDetail]
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/card relative rounded-xl border bg-white p-3 shadow-sm",
        "border-slate-200",
        "transition-shadow duration-200 ease-out",
        "hover:shadow-md hover:border-slate-300 hover:-translate-y-0.5",
        isDragging && !isDragOverlay && "opacity-40 shadow-none scale-[0.98]",
        isDragOverlay &&
          "shadow-2xl shadow-black/10 border-slate-300 ring-1 ring-black/5 rotate-[2deg] scale-105",
        isEditingThis && "ring-2 ring-blue-400/50 border-blue-300"
      )}
      onClick={handleCardClick}
    >
      {/* Drag handle */}
      {!isEditingThis && (
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

      {/* Row 1: Priority dot + Title + Type icon */}
      <div className="flex items-start gap-2">
        {/* Priority indicator */}
        {showPriority && (
          <>
            {isEditingThis && editingField === "priority" ? (
              <InlineFieldEditor item={item} field="priority" />
            ) : (
              <span
                className={cn(
                  "mt-1 block size-2 shrink-0 rounded-full cursor-pointer",
                  item.priority === "urgent" &&
                    "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]",
                  item.priority === "high" &&
                    "bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.3)]",
                  item.priority === "medium" && "bg-yellow-500",
                  item.priority === "low" && "bg-blue-400",
                  item.priority === "none" && "bg-slate-300"
                )}
                title={priorityConfig.label}
                onClick={(e) => handleFieldClick(e, "priority")}
              />
            )}
          </>
        )}

        {/* Title — always shown */}
        <span
          className="flex-1 text-[13px] font-medium leading-snug text-slate-800 line-clamp-2 cursor-pointer hover:text-violet-600 hover:underline"
          onClick={handleTitleClick}
        >
          {item.title}
        </span>

        {/* Type icon */}
        {showType && (
          <>
            {isEditingThis && editingField === "type" ? (
              <InlineFieldEditor item={item} field="type" />
            ) : (
              <TypeIcon
                className="mt-0.5 size-3.5 shrink-0 text-slate-300 cursor-pointer hover:text-slate-500"
                onClick={(e: React.MouseEvent) => handleFieldClick(e, "type")}
              />
            )}
          </>
        )}
      </div>

      {/* Row 2: Category badge + Due date + Status */}
      {(showCategory || showDueDate) && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {/* Category */}
          {showCategory && (
            <>
              {isEditingThis && editingField === "category" ? (
                <InlineFieldEditor item={item} field="category" />
              ) : (
                <Badge
                  variant="secondary"
                  className="h-[18px] px-1.5 text-[10px] font-medium rounded-md bg-slate-100 text-slate-600 border-0 cursor-pointer hover:bg-slate-200"
                  onClick={(e: React.MouseEvent) =>
                    handleFieldClick(e, "category")
                  }
                >
                  {categoryConfig.label}
                </Badge>
              )}
            </>
          )}

          {/* Due date */}
          {showDueDate && (
            <>
              {isEditingThis && editingField === "due_date" ? (
                <InlineFieldEditor item={item} field="due_date" />
              ) : dueDate ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 text-[10px] font-medium cursor-pointer",
                    isOverdue && "text-red-500 hover:text-red-600",
                    isDueToday && "text-amber-600 hover:text-amber-700",
                    !isOverdue &&
                      !isDueToday &&
                      "text-slate-400 hover:text-slate-500"
                  )}
                  onClick={(e) => handleFieldClick(e, "due_date")}
                >
                  <Calendar className="size-2.5" />
                  {format(dueDate, "d MMM", { locale: ru })}
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium text-slate-300 cursor-pointer hover:text-slate-400"
                  onClick={(e) => handleFieldClick(e, "due_date")}
                >
                  <Calendar className="size-2.5" />
                  <span>+</span>
                </span>
              )}
            </>
          )}

          {/* Status indicator (always clickable, shown as a small badge) */}
          {isEditingThis && editingField === "status" ? (
            <InlineFieldEditor item={item} field="status" />
          ) : (
            <span
              className="inline-flex items-center text-[10px] font-medium text-slate-400 cursor-pointer hover:text-slate-500"
              onClick={(e) => handleFieldClick(e, "status")}
              title={STATUS_CONFIG[item.status].label}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full mr-0.5",
                  item.status === "inbox" && "bg-gray-400",
                  item.status === "todo" && "bg-blue-400",
                  item.status === "in_progress" && "bg-amber-400",
                  item.status === "review" && "bg-purple-400",
                  item.status === "done" && "bg-emerald-400"
                )}
              />
            </span>
          )}
        </div>
      )}

      {/* Row 3: Subtasks based on display mode */}
      {showSubtasks && (
        <>
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
