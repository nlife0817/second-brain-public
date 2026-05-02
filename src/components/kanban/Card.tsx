"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ItemWithSubtasks,
  ItemPriority,
  ItemType,
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  TYPE_CONFIG,
  KANBAN_COLUMNS,
} from "@/types";
import { useBrainStore, useCategoryConfig } from "@/lib/store";
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
  Link,
  MessageSquare,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardTimerControl } from "@/components/timing/CardTimerControl";

const sourceIcons: Record<string, LucideIcon> = {
  kaiten: ExternalLink,
  claude: Sparkles,
};

const sourceLabels: Record<string, string> = {
  kaiten: "Kaiten",
  claude: "Claude",
};

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
  const categories = useBrainStore((s) => s.categories);
  const containerRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

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

  // Auto-focus date input
  useEffect(() => {
    if (field === "due_date" && dateRef.current) {
      dateRef.current.focus();
      try {
        dateRef.current.showPicker();
      } catch {
        // showPicker may fail in some browsers
      }
    }
  }, [field]);

  const handleChange = useCallback(
    async (value: string) => {
      await updateItem(item.id, { [field]: value });
      setEditingItem(null);
    },
    [updateItem, item.id, field, setEditingItem]
  );

  // Detect if dropdown should open upward
  const [openUp, setOpenUp] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (spaceBelow < 180) setOpenUp(true);
    }
  }, []);

  // Helper to render an already-open option list
  const renderOptionList = (
    currentValue: string,
    options: { key: string; label: string }[]
  ) => (
    <div
      ref={containerRef}
      className="relative"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={listRef}
        className={cn(
          "absolute left-0 z-50 min-w-[140px] max-h-[180px] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg",
          openUp ? "bottom-full mb-1" : "top-full mt-1"
        )}
      >
        {options.map((opt) => (
          <button
            key={opt.key}
            onClick={(e) => {
              e.stopPropagation();
              handleChange(opt.key);
            }}
            className={cn(
              "flex w-full items-center px-3 py-1.5 text-[11px] hover:bg-slate-50 text-left",
              opt.key === currentValue &&
                "bg-violet-50 text-violet-700 font-medium"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (field === "priority") {
    return renderOptionList(
      item.priority,
      (Object.keys(PRIORITY_CONFIG) as ItemPriority[]).map((p) => ({
        key: p,
        label: PRIORITY_CONFIG[p].label,
      }))
    );
  }

  if (field === "status") {
    return renderOptionList(
      item.status,
      KANBAN_COLUMNS.map((s) => ({
        key: s,
        label: STATUS_CONFIG[s].label,
      }))
    );
  }

  if (field === "category") {
    return renderOptionList(
      item.category,
      categories.map((c) => ({
        key: c.id,
        label: c.name,
      }))
    );
  }

  if (field === "type") {
    return renderOptionList(
      item.type,
      (Object.keys(TYPE_CONFIG) as ItemType[]).map((t) => ({
        key: t,
        label: TYPE_CONFIG[t].label,
      }))
    );
  }

  if (field === "due_date") {
    return (
      <div
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={dateRef}
          type="date"
          defaultValue={item.due_date ?? ""}
          onChange={(e) => handleChange(e.target.value || "")}
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

export const KanbanCard = React.memo(function KanbanCard({ item, isDragOverlay = false }: KanbanCardProps) {
  const openDetail = useBrainStore((s) => s.openDetail);
  const editingItemId = useBrainStore((s) => s.editingItemId);
  const editingField = useBrainStore((s) => s.editingField);
  const setEditingItem = useBrainStore((s) => s.setEditingItem);
  const subtaskDisplayMode = useBrainStore((s) => s.subtaskDisplayMode);
  const cardVisibleFields = useBrainStore((s) => s.cardVisibleFields);
  const relCount = useBrainStore((s) => s.itemRelationCounts[item.id] ?? 0);
  const commentCount = useBrainStore((s) => s.itemCommentCounts[item.id] ?? 0);

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
  const allCategoryConfig = useCategoryConfig();
  const catConfig = allCategoryConfig[item.category];
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
          className="flex-1 text-[13px] font-medium leading-snug text-slate-800 line-clamp-2 cursor-pointer hover:text-violet-600 hover:underline inline-flex items-center gap-1"
          onClick={handleTitleClick}
        >
          {item.source && item.source !== "system" && (() => {
            const SrcIcon = sourceIcons[item.source];
            return SrcIcon ? <span title={sourceLabels[item.source]}><SrcIcon className="size-3 text-slate-300 shrink-0" /></span> : null;
          })()}
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
                  {catConfig?.label ?? item.category}
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
                  {item.due_time && <span className="ml-0.5">· {item.due_time}</span>}
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

          {/* Relation & comment indicators */}
          {relCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400" title={`Связи: ${relCount}`}>
              <Link className="size-2.5" />
              <span>{relCount}</span>
            </span>
          )}
          {commentCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400" title={`Комментарии: ${commentCount}`}>
              <MessageSquare className="size-2.5" />
              <span>{commentCount}</span>
            </span>
          )}

          {/* Timer indicator (active session) / total tracked time + start button */}
          {(item.type === "task" || item.type === "meeting" || item.type === "plan") && (
            <span className="ml-auto inline-flex items-center">
              <CardTimerControl
                itemId={item.id}
                itemTitle={item.title}
                hoverGroup="card"
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
});
