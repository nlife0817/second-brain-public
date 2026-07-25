"use client";

import { CheckCircle2, MessageSquare, GitBranch } from "lucide-react";
import { AvatarStack, PriorityDot, dueTone, formatDue } from "./bits";
import type { TaskWithMeta } from "@/lib/core/types";
import { cn } from "@/lib/utils";

export function TaskCard({
  task,
  onClick,
  className,
}: {
  task: TaskWithMeta;
  onClick?: () => void;
  className?: string;
}) {
  const completed = !!task.completed_at;
  const due = formatDue(task.due_date, task.due_time);
  return (
    <button
      onClick={onClick}
      className={cn(
        "group w-full rounded-lg border border-border bg-card p-2.5 text-left shadow-xs transition-colors hover:border-ring/40",
        className,
      )}
    >
      <div className="flex items-start gap-1.5">
        <PriorityDot priority={task.priority} className="mt-1.5" />
        <p className={cn("flex-1 text-sm leading-snug", completed && "text-muted-foreground line-through")}>
          {task.title || "Без названия"}
        </p>
      </div>
      {task.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.tags.map((t) => (
            <span
              key={t.id}
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: `${t.color}1a`, color: t.color }}
            >
              {t.name}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        {due && <span className={dueTone(task.due_date, completed)}>{due}</span>}
        {task.subtask_count > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <GitBranch className="size-3" />
            {task.subtask_done_count}/{task.subtask_count}
          </span>
        )}
        {task.comment_count > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <MessageSquare className="size-3" />
            {task.comment_count}
          </span>
        )}
        {completed && <CheckCircle2 className="size-3 text-emerald-500" />}
        <span className="flex-1" />
        {task.assignees.length > 0 && <AvatarStack users={task.assignees} />}
      </div>
    </button>
  );
}
