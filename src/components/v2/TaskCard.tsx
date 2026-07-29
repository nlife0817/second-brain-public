"use client";

import { memo } from "react";
import { CheckCircle2, Clock3, MessageSquare, GitBranch } from "lucide-react";
import { AvatarStack, PriorityDot, chipStyle, dueTone, formatDue } from "./bits";
import type { ProjectWithMeta, TaskListItem } from "@/lib/core/types";
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
 * `card` — плитка колонки доски: ширина фиксирована колонкой, поэтому проект,
 * теги и метаданные встают отдельными строками.
 * `row` — строка плотного списка: всё в один ряд высотой ~32px, чтобы на экран
 * помещалось втрое больше задач.
 * `compact` — та же плотность для телефона, но в две строки: на 375px в один
 * ряд названию остаётся около 260px, и оно обрезается на середине. Здесь
 * название занимает свою строку целиком, а метки, метаданные и аватары
 * съезжают под него одной строкой.
 */
export type TaskCardVariant = "card" | "row" | "compact";

/**
 * Метка, сжатая до цвета: в строке места на названия нет, поэтому имя уходит в
 * подсказку и разворачивается только на широком экране. Квадратная точка —
 * проект, круглая — тег: та же разница формы, что у чипов на доске.
 */
function MiniChip({
  color,
  label,
  hint,
  square,
}: {
  color: string | null | undefined;
  label: string;
  hint: string;
  square?: boolean;
}) {
  return (
    <span title={hint} className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
      <span
        className={cn("size-2 shrink-0", square ? "rounded-[3px]" : "rounded-full")}
        style={{ backgroundColor: color ?? "#94a3b8" }}
      />
      <span className="hidden max-w-28 truncate lg:inline-block">{label}</span>
    </span>
  );
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
  variant = "card",
  className,
}: {
  task: TaskListItem;
  onOpen?: (taskId: string) => void;
  variant?: TaskCardVariant;
  className?: string;
}) {
  const fields = useCardStore((s) => s.cardFields);
  const projects = useV2Store((s) => s.projects);
  const completed = !!task.completed_at;
  const due = formatDue(task.due_date, task.due_time);
  const show = (field: CardFieldId) => fields.includes(field);

  const taskProjects: ProjectWithMeta[] = [];
  if (show("project")) {
    for (const p of task.placements) {
      const project = projects.find((x) => x.id === p.project_id);
      // Проект недоступен или справочник ещё не приехал — метку не рисуем.
      if (project) taskProjects.push(project);
    }
  }
  const showTags = show("tags") && task.tags.length > 0;
  const showAssignees = show("assignees") && task.assignees.length > 0;
  const hasMeta =
    (show("due_date") && !!due) ||
    (show("estimated_minutes") && task.estimated_minutes != null) ||
    (show("subtasks") && task.subtask_count > 0) ||
    (show("comments") && task.comment_count > 0) ||
    completed;

  // Метаданные одинаковы в обоих видах — меняется только контейнер вокруг них.
  const meta = (
    <>
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
    </>
  );

  /** Метки проектов и тегов, сжатые до точек — общий кусок плотных видов. */
  const chipDots = (
    <>
      {taskProjects.map((p) => (
        <MiniChip key={p.id} color={p.color} label={p.name} hint={`Проект: ${p.name}`} square />
      ))}
      {showTags &&
        task.tags.map((t) => <MiniChip key={t.id} color={t.color} label={t.name} hint={`Тег: ${t.name}`} />)}
    </>
  );

  if (variant === "compact") {
    return (
      <button
        onClick={onOpen ? () => onOpen(task.id) : undefined}
        className={cn(
          "group flex w-full flex-col rounded-md px-2 py-2 text-left transition-colors active:bg-muted/60",
          className,
        )}
      >
        <span className="flex w-full items-start gap-2">
          {show("priority") && (
            <span className="mt-1 flex size-2 shrink-0">
              <PriorityDot priority={task.priority} />
            </span>
          )}
          {/* Две строки, а не одна: обрезанное на середине название на телефоне
              не даёт узнать задачу, а третья строка уже возвращает прежний рост. */}
          <span
            className={cn(
              "min-w-0 flex-1 line-clamp-2 text-sm leading-snug",
              completed && "text-muted-foreground line-through",
            )}
          >
            {task.title || "Без названия"}
          </span>
        </span>
        {(taskProjects.length > 0 || showTags || hasMeta || showAssignees) && (
          <span className="mt-1 flex w-full items-center gap-2 pl-4 text-[11px] text-muted-foreground">
            {chipDots}
            {meta}
            <span className="flex-1" />
            {showAssignees && <AvatarStack users={task.assignees} />}
          </span>
        )}
      </button>
    );
  }

  if (variant === "row") {
    return (
      <button
        onClick={onOpen ? () => onOpen(task.id) : undefined}
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50",
          className,
        )}
      >
        {/* Слот фиксированной ширины: у задачи без приоритета точки нет, но
            названия в плотном списке должны стоять по одной вертикали. */}
        {show("priority") && (
          <span className="flex size-2 shrink-0">
            <PriorityDot priority={task.priority} />
          </span>
        )}
        <span className={cn("min-w-0 flex-1 truncate text-sm", completed && "text-muted-foreground line-through")}>
          {task.title || "Без названия"}
        </span>
        {(taskProjects.length > 0 || showTags) && (
          <span className="flex shrink-0 items-center gap-1.5">{chipDots}</span>
        )}
        {(hasMeta || showAssignees) && (
          <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
            {meta}
            {showAssignees && <AvatarStack users={task.assignees} />}
          </span>
        )}
      </button>
    );
  }

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

      {taskProjects.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {taskProjects.map((p) => (
            <span
              key={p.id}
              className="tinted-chip rounded px-1.5 py-0.5 text-[11px] font-medium"
              style={chipStyle(p.color)}
            >
              {p.name}
            </span>
          ))}
        </div>
      )}

      {showTags && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.tags.map((t) => (
            <span
              key={t.id}
              className="tinted-chip rounded-full px-1.5 py-0.5 text-[11px] font-medium"
              style={chipStyle(t.color)}
            >
              {t.name}
            </span>
          ))}
        </div>
      )}

      {(hasMeta || showAssignees) && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          {meta}
          <span className="flex-1" />
          {showAssignees && <AvatarStack users={task.assignees} />}
        </div>
      )}
    </button>
  );
});
