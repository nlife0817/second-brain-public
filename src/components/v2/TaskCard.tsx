"use client";

import { memo } from "react";
import { CheckCircle2, Clock3, MessageSquare, GitBranch } from "lucide-react";
import { AvatarStack, PriorityDot, dueTone, formatDue } from "./bits";
import type { TaskListItem } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { useCardStore, type CardFieldId } from "@/lib/core/view-store";
import { cn } from "@/lib/utils";

/** 90 → «1 ч 30 м». Дублирует формат таблицы, чтобы оценка читалась одинаково. */
function formatEstimate(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} ч ${m} м`;
  if (h) return `${h} ч`;
  return `${m} м`;
}

/**
 * Карточка мемоизирована: на доске их сотни, и без этого любое изменение
 * состояния страницы (а во время перетаскивания оно меняется на каждое
 * движение мыши) перерисовывало бы весь список.
 *
 * Поэтому обработчик принимает id, а не замыкание: инлайновая стрелка в
 * родителе создавалась бы заново на каждый рендер и сводила memo к нулю.
 *
 * Набор полей и справочник проектов карточка читает из сторов сама:
 * пробрасывать их через колонку и DraggableCard пришлось бы тремя уровнями
 * пропсов, а подписка перерисовывает карточки ровно тогда, когда настройку
 * меняют. Обе величины — стабильные ссылки, memo это не ломает.
 */
export const TaskCard = memo(function TaskCard({
  task,
  onOpen,
  className,
}: {
  task: TaskListItem;
  onOpen?: (taskId: string) => void;
  className?: string;
}) {
  const fields = useCardStore((s) => s.cardFields);
  const projects = useV2Store((s) => s.projects);
  const completed = !!task.completed_at;
  const due = formatDue(task.due_date, task.due_time);
  const show = (field: CardFieldId) => fields.includes(field);

  const showProject = show("project") && task.placements.length > 0;
  const hasFooter =
    (show("due_date") && due) ||
    (show("estimated_minutes") && task.estimated_minutes != null) ||
    (show("subtasks") && task.subtask_count > 0) ||
    (show("comments") && task.comment_count > 0) ||
    completed ||
    (show("assignees") && task.assignees.length > 0);

  return (
    <button
      onClick={onOpen ? () => onOpen(task.id) : undefined}
      className={cn(
        "group w-full rounded-lg border border-border bg-card p-2.5 text-left shadow-xs transition-colors hover:border-ring/40",
        className,
      )}
    >
      <div className="flex items-start gap-1.5">
        {show("priority") && <PriorityDot priority={task.priority} className="mt-1.5" />}
        <p className={cn("flex-1 text-sm leading-snug", completed && "text-muted-foreground line-through")}>
          {task.title || "Без названия"}
        </p>
      </div>

      {showProject && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.placements.map((p) => {
            const project = projects.find((x) => x.id === p.project_id);
            if (!project) return null;
            return (
              <span
                key={p.project_id}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: `${project.color}1a`, color: project.color }}
              >
                {project.name}
              </span>
            );
          })}
        </div>
      )}

      {show("tags") && task.tags.length > 0 && (
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

      {hasFooter && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          {show("due_date") && due && <span className={dueTone(task.due_date, completed)}>{due}</span>}
          {show("estimated_minutes") && task.estimated_minutes != null && (
            <span className="inline-flex items-center gap-0.5">
              <Clock3 className="size-3" />
              {formatEstimate(task.estimated_minutes)}
            </span>
          )}
          {show("subtasks") && task.subtask_count > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <GitBranch className="size-3" />
              {task.subtask_done_count}/{task.subtask_count}
            </span>
          )}
          {show("comments") && task.comment_count > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <MessageSquare className="size-3" />
              {task.comment_count}
            </span>
          )}
          {completed && <CheckCircle2 className="size-3 text-emerald-500" />}
          <span className="flex-1" />
          {show("assignees") && task.assignees.length > 0 && <AvatarStack users={task.assignees} />}
        </div>
      )}
    </button>
  );
});
