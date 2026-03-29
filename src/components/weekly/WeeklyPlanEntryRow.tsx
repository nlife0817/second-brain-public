"use client";

import { memo, useState } from "react";
import { X, Clock, CheckCircle2, XCircle, ArrowRight, Calendar, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBrainStore } from "@/lib/store";
import type { WeeklyPlanEntryWithItem, EntryResultStatus, Item } from "@/types";
import { PRIORITY_CONFIG, RESULT_STATUS_CONFIG, STATUS_CONFIG, CATEGORY_CONFIG } from "@/types";
import { Button } from "@/components/ui/button";

const statusIcons: Record<EntryResultStatus, typeof Clock> = {
  pending: Clock,
  done: CheckCircle2,
  not_done: XCircle,
  transferred: ArrowRight,
};

const statusCycle: EntryResultStatus[] = ["pending", "done", "not_done", "transferred"];

const statusBg: Record<EntryResultStatus, string> = {
  pending: "",
  done: "bg-emerald-50/50",
  not_done: "bg-red-50/30",
  transferred: "bg-amber-50/30",
};

interface Props {
  entry: WeeklyPlanEntryWithItem;
  planId: string;
  mode: "triage" | "review";
  onRemove?: () => void;
}

export const WeeklyPlanEntryRow = memo(function WeeklyPlanEntryRow({ entry, planId, mode, onRemove }: Props) {
  const updatePlanEntry = useBrainStore((s) => s.updatePlanEntry);
  const addEntryComment = useBrainStore((s) => s.addEntryComment);
  const openDetail = useBrainStore((s) => s.openDetail);
  const [newComment, setNewComment] = useState("");
  const [isAddingComment, setIsAddingComment] = useState(false);

  const { item } = entry;
  const priorityCfg = PRIORITY_CONFIG[item.priority];
  const statusCfg = RESULT_STATUS_CONFIG[entry.result_status];
  const StatusIcon = statusIcons[entry.result_status];

  const lastComment = entry.comments?.length > 0 ? entry.comments[entry.comments.length - 1] : null;

  const cycleStatus = () => {
    const idx = statusCycle.indexOf(entry.result_status);
    const next = statusCycle[(idx + 1) % statusCycle.length];
    updatePlanEntry(planId, entry.id, { result_status: next });
  };

  const submitComment = () => {
    const trimmed = newComment.trim();
    if (trimmed) {
      addEntryComment(planId, entry.id, trimmed);
    }
    setNewComment("");
    setIsAddingComment(false);
  };

  const cancelComment = () => {
    setNewComment("");
    setIsAddingComment(false);
  };

  // Triage mode — show all task fields + subtasks
  if (mode === "triage") {
    return <TriageRow entry={entry} item={item} onRemove={onRemove} />;
  }

  // Review mode — two columns: Plan (plain) | Result (status + comment) + subtasks
  return <ReviewRow entry={entry} item={item} cycleStatus={cycleStatus} statusCfg={statusCfg} StatusIcon={StatusIcon} priorityCfg={priorityCfg} lastComment={lastComment} isAddingComment={isAddingComment} setIsAddingComment={setIsAddingComment} newComment={newComment} setNewComment={setNewComment} submitComment={submitComment} cancelComment={cancelComment} openDetail={openDetail} />;
});

// --- Review row with subtask support ---

function ReviewRow({ entry, item, cycleStatus, statusCfg, StatusIcon, priorityCfg, lastComment, isAddingComment, setIsAddingComment, newComment, setNewComment, submitComment, cancelComment, openDetail }: {
  entry: WeeklyPlanEntryWithItem; item: Item; cycleStatus: () => void;
  statusCfg: { label: string; color: string }; StatusIcon: typeof Clock; priorityCfg: { color: string; icon: string };
  lastComment: { text: string } | null; isAddingComment: boolean; setIsAddingComment: (v: boolean) => void;
  newComment: string; setNewComment: (v: string) => void; submitComment: () => void; cancelComment: () => void;
  openDetail: (id: string) => void;
}) {
  const items = useBrainStore((s) => s.items);
  const subtaskDisplayMode = useBrainStore((s) => s.subtaskDisplayMode);
  const [expanded, setExpanded] = useState(false);

  const fullItem = items.find((i) => i.id === item.id);
  const subtasks = fullItem?.subtasks || [];
  const hasSubtasks = subtasks.length > 0;
  const doneSubtasks = subtasks.filter((s) => s.status === "done").length;

  const showSubtasksInline = subtaskDisplayMode === "inline" && hasSubtasks;
  const showSubtasksAccordion = subtaskDisplayMode === "accordion" && hasSubtasks;

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div className="grid grid-cols-1 md:grid-cols-2">
        {/* Plan column */}
        <div className="flex items-center gap-2 px-3 py-2 md:border-r border-slate-100">
          {showSubtasksAccordion && (
            <button onClick={() => setExpanded(!expanded)} className="shrink-0 p-0.5 text-slate-400 hover:text-slate-600">
              <ChevronDown className={cn("size-3 transition-transform", !expanded && "-rotate-90")} />
            </button>
          )}
          {item.priority !== "none" && (
            <span className={cn("text-xs shrink-0", priorityCfg.color)}>{priorityCfg.icon}</span>
          )}
          <button
            className="text-sm text-slate-700 truncate hover:text-slate-900 text-left min-w-0"
            onClick={() => openDetail(item.id)}
          >
            {item.title}
          </button>
          {hasSubtasks && (
            <span className="text-[10px] text-slate-400 shrink-0 tabular-nums ml-auto">{doneSubtasks}/{subtasks.length}</span>
          )}
        </div>

        {/* Result column */}
        <div className={cn("flex flex-col gap-1 px-3 py-2 rounded-r-md", statusBg[entry.result_status])}>
          <div className="flex items-center gap-2">
            <button
              onClick={cycleStatus}
              className={cn("shrink-0 p-0.5 rounded hover:bg-white/80 transition-colors", statusCfg.color)}
              title={statusCfg.label}
              aria-label={`Статус: ${statusCfg.label}. Нажмите для смены`}
            >
              <StatusIcon className="size-4" />
            </button>
            <span className={cn(
              "text-sm truncate min-w-0",
              entry.result_status === "done" ? "text-slate-400 line-through" :
              entry.result_status === "not_done" ? "text-red-600/70" :
              entry.result_status === "transferred" ? "text-amber-600/70" :
              "text-slate-700"
            )}>
              {item.title}
            </span>
            {isAddingComment ? (
              <input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onBlur={() => { if (newComment.trim()) submitComment(); else cancelComment(); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); submitComment(); }
                  if (e.key === "Escape") cancelComment();
                }}
                className="ml-auto h-5 text-xs flex-shrink-0 w-[200px] px-1.5 rounded border border-slate-200 bg-white outline-none focus:border-blue-400"
                autoFocus
                placeholder="Новый комментарий..."
              />
            ) : (
              <button
                className={cn(
                  "ml-auto text-xs truncate text-left shrink-0 max-w-[200px]",
                  lastComment ? "text-slate-500 italic" : "text-slate-300 hover:text-slate-400"
                )}
                onClick={() => setIsAddingComment(true)}
                title={lastComment ? `Последний: ${lastComment.text}` : undefined}
              >
                {lastComment ? lastComment.text : "+ комментарий"}
              </button>
            )}
          </div>
          {entry.comments && entry.comments.length > 1 && (
            <div className="ml-6 space-y-0.5">
              {entry.comments.slice(0, -1).map((c) => (
                <p key={c.id} className="text-[10px] text-slate-400 italic truncate">
                  <span className="text-slate-300">{new Date(c.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}:</span>{" "}
                  {c.text}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Subtasks inline */}
      {showSubtasksInline && (
        <ReviewSubtasksList subtasks={subtasks} onOpenDetail={openDetail} />
      )}
      {/* Subtasks accordion */}
      {showSubtasksAccordion && expanded && (
        <ReviewSubtasksList subtasks={subtasks} onOpenDetail={openDetail} />
      )}
    </div>
  );
}

// --- Triage row with subtask support ---

function TriageRow({ item, onRemove }: { entry?: WeeklyPlanEntryWithItem; item: Item; onRemove?: () => void }) {
  const openDetail = useBrainStore((s) => s.openDetail);
  const items = useBrainStore((s) => s.items);
  const subtaskDisplayMode = useBrainStore((s) => s.subtaskDisplayMode);
  const [expanded, setExpanded] = useState(false);

  const priorityCfg = PRIORITY_CONFIG[item.priority];
  const itemStatusCfg = STATUS_CONFIG[item.status];

  // Find subtasks from store
  const fullItem = items.find((i) => i.id === item.id);
  const subtasks = fullItem?.subtasks || [];
  const hasSubtasks = subtasks.length > 0;
  const doneSubtasks = subtasks.filter((s) => s.status === "done").length;

  const formatDueDate = (d: string | null) => {
    if (!d) return null;
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  };

  const showSubtasksInline = subtaskDisplayMode === "inline" && hasSubtasks;
  const showSubtasksAccordion = subtaskDisplayMode === "accordion" && hasSubtasks;

  return (
    <div>
      <div className="group flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 rounded-md">
        {/* Accordion toggle */}
        {showSubtasksAccordion && (
          <button onClick={() => setExpanded(!expanded)} className="shrink-0 p-0.5 text-slate-400 hover:text-slate-600">
            <ChevronDown className={cn("size-3 transition-transform", !expanded && "-rotate-90")} />
          </button>
        )}
        {item.priority !== "none" && (
          <span className={cn("text-xs shrink-0", priorityCfg.color)}>{priorityCfg.icon}</span>
        )}
        <button
          className="flex-1 text-left text-sm text-slate-700 truncate hover:text-slate-900 min-w-0"
          onClick={() => openDetail(item.id)}
        >
          {item.title}
        </button>
        {/* Subtask count badge */}
        {hasSubtasks && (
          <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">{doneSubtasks}/{subtasks.length}</span>
        )}
        <span className={cn("text-[10px] px-1 py-0.5 rounded shrink-0", itemStatusCfg.color)}>{itemStatusCfg.label}</span>
        {item.due_date && (
          <span className="text-[10px] text-slate-400 shrink-0 flex items-center gap-0.5">
            <Calendar className="size-2.5" />
            {formatDueDate(item.due_date)}
          </span>
        )}
        <span className="text-[10px] text-slate-400 shrink-0">{CATEGORY_CONFIG[item.category].label}</span>
        {onRemove && (
          <Button
            variant="ghost" size="icon-xs"
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-slate-400 hover:text-red-500 shrink-0"
            onClick={onRemove}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Subtasks — inline (always shown) */}
      {showSubtasksInline && (
        <SubtasksList subtasks={subtasks} onOpenDetail={openDetail} />
      )}

      {/* Subtasks — accordion (toggle) */}
      {showSubtasksAccordion && expanded && (
        <SubtasksList subtasks={subtasks} onOpenDetail={openDetail} />
      )}
    </div>
  );
}

function SubtasksList({ subtasks, onOpenDetail }: { subtasks: Item[]; onOpenDetail: (id: string) => void }) {
  return (
    <div className="ml-8 mb-1 pl-3 border-l-2 border-slate-100">
      {subtasks.map((sub) => {
        const isDone = sub.status === "done";
        return (
          <div key={sub.id} className="flex items-center gap-2 px-2 py-0.5 hover:bg-slate-50 rounded-sm">
            <span className={cn("size-1.5 rounded-full shrink-0", isDone ? "bg-emerald-400" : "bg-slate-300")} />
            <button
              className={cn(
                "text-xs text-left truncate min-w-0",
                isDone ? "text-slate-400 line-through" : "text-slate-600 hover:text-slate-900"
              )}
              onClick={() => onOpenDetail(sub.id)}
            >
              {sub.title}
            </button>
            {sub.priority !== "none" && (
              <span className={cn("text-[10px] shrink-0", PRIORITY_CONFIG[sub.priority].color)}>
                {PRIORITY_CONFIG[sub.priority].icon}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Two-column subtask list for review mode (Plan | Result with status)
function ReviewSubtasksList({ subtasks, onOpenDetail }: { subtasks: Item[]; onOpenDetail: (id: string) => void }) {
  return (
    <div className="border-t border-slate-50">
      {subtasks.map((sub) => {
        const isDone = sub.status === "done";
        const subStatusCfg = STATUS_CONFIG[sub.status];
        return (
          <div key={sub.id} className="grid grid-cols-1 md:grid-cols-2 border-b border-slate-50 last:border-b-0">
            {/* Plan column — subtask name */}
            <div className="flex items-center gap-2 pl-8 pr-3 py-1 md:border-r border-slate-50">
              <span className={cn("size-1.5 rounded-full shrink-0", isDone ? "bg-emerald-400" : "bg-slate-300")} />
              <button
                className={cn(
                  "text-xs text-left truncate min-w-0",
                  isDone ? "text-slate-400 line-through" : "text-slate-600 hover:text-slate-900"
                )}
                onClick={() => onOpenDetail(sub.id)}
              >
                {sub.title}
              </button>
            </div>
            {/* Result column — subtask status */}
            <div className={cn("flex items-center gap-2 pl-8 md:pl-3 pr-3 py-1", isDone ? "bg-emerald-50/30" : "")}>
              <span className={cn("size-1.5 rounded-full shrink-0", isDone ? "bg-emerald-400" : "bg-slate-300")} />
              <span className={cn("text-xs truncate", isDone ? "text-slate-400 line-through" : "text-slate-600")}>
                {sub.title}
              </span>
              <span className={cn("text-[10px] px-1 py-0.5 rounded shrink-0 ml-auto", subStatusCfg.color)}>
                {subStatusCfg.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
