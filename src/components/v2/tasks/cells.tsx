"use client";

// Ячейки сводной таблицы задач. Каждая редактируемая ячейка — поповер с
// подходящим редактором; наружу отдаётся только патч (id + изменённые поля),
// саму мутацию делает страница.

import { memo, useEffect, useRef, useState } from "react";
import { Check, MessageSquare, Pencil, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarStack, PRIORITY_LABELS, PriorityDot, chipStyle, dueTone, formatDue } from "@/components/v2/bits";
import { DatePicker, DuePicker } from "@/components/v2/DuePicker";
import { assigneeChoice } from "@/lib/core/assignable";
import type {
  CoreTag,
  OrgMemberWithUser,
  ProjectWithMeta,
  TaskPriority,
  TaskRow,
  TaskStatus,
} from "@/lib/core/types";
import { cn } from "@/lib/utils";

export interface CellContext {
  statuses: TaskStatus[];
  tags: CoreTag[];
  members: OrgMemberWithUser[];
  projectsById: Map<string, ProjectWithMeta>;
  canEdit: boolean;
  onPatch: (taskId: string, payload: Record<string, unknown>) => void;
}

/** 90 → «1 ч 30 м». Пустая оценка отображается прочерком, а не нулём. */
export function formatEstimate(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} ч ${m} м`;
  if (h) return `${h} ч`;
  return `${m} м`;
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

const CELL_BUTTON =
  "flex h-full w-full items-center gap-1 rounded px-1.5 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Некликабельная обёртка — когда прав на правку нет. */
function ReadOnly({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <span className={cn("flex h-full items-center gap-1 px-1.5", className)}>{children}</span>;
}

// --- Приоритет ------------------------------------------------------------------

const PRIORITY_ORDER: TaskPriority[] = ["urgent", "high", "medium", "low", "none"];

export const PriorityCell = memo(function PriorityCell({
  task,
  ctx,
}: {
  task: TaskRow;
  ctx: CellContext;
}) {
  if (!ctx.canEdit) {
    return (
      <ReadOnly className="justify-center">
        <PriorityDot priority={task.priority} />
      </ReadOnly>
    );
  }
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button className={cn(CELL_BUTTON, "justify-center")} title={PRIORITY_LABELS[task.priority].label} />
        }
      >
        {task.priority === "none" ? (
          <span className="size-2 rounded-full border border-dashed border-muted-foreground/50" />
        ) : (
          <PriorityDot priority={task.priority} />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        {PRIORITY_ORDER.map((p) => (
          <button
            key={p}
            onClick={() => ctx.onPatch(task.id, { priority: p })}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <span className={cn("size-2 shrink-0 rounded-full", PRIORITY_LABELS[p].dot)} />
            <span className="flex-1 text-left">{PRIORITY_LABELS[p].label}</span>
            {task.priority === p && <Check className="size-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
});

// --- Название -------------------------------------------------------------------

export const TitleCell = memo(function TitleCell({
  task,
  ctx,
  depth,
  onOpen,
}: {
  task: TaskRow;
  ctx: CellContext;
  depth: number;
  onOpen: (taskId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== task.title) ctx.onPatch(task.id, { title: next });
    else setDraft(task.title);
  }

  if (editing) {
    return (
      <span className="flex h-full items-center px-1.5" style={{ paddingLeft: depth * 16 + 6 }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(task.title);
              setEditing(false);
            }
          }}
          className="w-full rounded border border-ring bg-background px-1 py-0.5 text-sm outline-none"
        />
      </span>
    );
  }

  return (
    <span className="group/title flex h-full items-center gap-1" style={{ paddingLeft: depth * 16 + 6 }}>
      <button
        onClick={() => onOpen(task.id)}
        className={cn(
          "min-w-0 flex-1 truncate text-left text-sm hover:underline",
          task.completed_at && "text-muted-foreground line-through",
        )}
        title={task.title}
      >
        {task.title}
      </button>
      {ctx.canEdit && (
        <button
          onClick={() => {
            setDraft(task.title);
            setEditing(true);
          }}
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover/title:opacity-100"
          title="Переименовать"
        >
          <Pencil className="size-3" />
        </button>
      )}
    </span>
  );
});

// --- Статус ----------------------------------------------------------------------

export const StatusCell = memo(function StatusCell({ task, ctx }: { task: TaskRow; ctx: CellContext }) {
  const status = task.status_id ? ctx.statuses.find((s) => s.id === task.status_id) : undefined;
  const label = status ? (
    <span
      className="tinted-chip inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-xs font-medium"
      style={chipStyle(status.color)}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
      <span className="truncate">{status.name}</span>
    </span>
  ) : (
    <span className="text-xs text-muted-foreground">Без статуса</span>
  );

  if (!ctx.canEdit) return <ReadOnly>{label}</ReadOnly>;

  return (
    <Popover>
      <PopoverTrigger render={<button className={CELL_BUTTON} />}>{label}</PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-1">
        {ctx.statuses.map((s) => (
          <button
            key={s.id}
            onClick={() => ctx.onPatch(task.id, { status_id: s.id })}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="flex-1 truncate text-left">{s.name}</span>
            {task.status_id === s.id && <Check className="size-3.5 shrink-0" />}
          </button>
        ))}
        <button
          onClick={() => ctx.onPatch(task.id, { status_id: null })}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"
        >
          <X className="size-3.5" /> Снять статус
        </button>
      </PopoverContent>
    </Popover>
  );
});

// --- Проекты (multi-homing) ------------------------------------------------------

export const ProjectCell = memo(function ProjectCell({ task, ctx }: { task: TaskRow; ctx: CellContext }) {
  if (task.placements.length === 0) {
    return <ReadOnly className="text-xs text-muted-foreground">Личная</ReadOnly>;
  }
  return (
    <ReadOnly className="gap-1 overflow-hidden">
      {task.placements.map((p) => {
        const project = ctx.projectsById.get(p.project_id);
        return (
          <span
            key={p.project_id}
            className="tinted-chip inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-xs"
            style={chipStyle(project?.color)}
            title={project?.name ?? "Недоступный проект"}
          >
            <span className="truncate">{project?.name ?? "—"}</span>
          </span>
        );
      })}
    </ReadOnly>
  );
});

// --- Исполнители ------------------------------------------------------------------

export const AssigneesCell = memo(function AssigneesCell({ task, ctx }: { task: TaskRow; ctx: CellContext }) {
  const current = new Set(task.assignees.map((a) => a.id));
  // Пустые ячейки молчат: три десятка прочерков в таблице — сплошной шум,
  // а кликабельность и так видна по подсветке ячейки при наведении.
  const label = task.assignees.length > 0 ? <AvatarStack users={task.assignees} max={3} /> : null;

  if (!ctx.canEdit) return <ReadOnly>{label}</ReadOnly>;

  function toggle(userId: string) {
    const next = current.has(userId)
      ? task.assignees.filter((a) => a.id !== userId).map((a) => a.id)
      : [...task.assignees.map((a) => a.id), userId];
    ctx.onPatch(task.id, { assignee_ids: next });
  }

  // Закрытый проект пускает в исполнители только своих участников.
  const choice = assigneeChoice(
    ctx.members,
    ctx.projectsById,
    task.placements.map((p) => p.project_id),
    current,
  );

  return (
    <Popover>
      <PopoverTrigger render={<button className={CELL_BUTTON} />}>{label}</PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-60 overflow-y-auto p-1">
        {choice.members.map((m) => (
          <button
            key={m.user_id}
            onClick={() => toggle(m.user_id)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <Avatar
              user={{ id: m.user_id, email: m.email, name: m.name, avatar_url: m.avatar_url }}
              size="xs"
            />
            <span className="flex-1 truncate text-left">{m.name || m.email}</span>
            {current.has(m.user_id) && <Check className="size-3.5 shrink-0" />}
          </button>
        ))}
        {choice.members.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {ctx.members.length === 0 ? "Участники ещё не загружены" : "В закрытом проекте некого назначить"}
          </p>
        )}
        {choice.restrictedBy.length > 0 && (
          <p className="border-t border-border px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
            Только участники закрытого проекта «{choice.restrictedBy.join("», «")}»
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
});

// --- Теги ---------------------------------------------------------------------------

export const TagsCell = memo(function TagsCell({ task, ctx }: { task: TaskRow; ctx: CellContext }) {
  const current = new Set(task.tags.map((t) => t.id));
  const label =
    task.tags.length > 0 ? (
      <span className="flex gap-1 overflow-hidden">
        {task.tags.map((t) => (
          <span
            key={t.id}
            className="tinted-chip truncate rounded px-1.5 py-0.5 text-[11px]"
            style={chipStyle(t.color)}
          >
            {t.name}
          </span>
        ))}
      </span>
    ) : null;

  if (!ctx.canEdit) return <ReadOnly>{label}</ReadOnly>;

  function toggle(tagId: string) {
    const next = current.has(tagId)
      ? task.tags.filter((t) => t.id !== tagId).map((t) => t.id)
      : [...task.tags.map((t) => t.id), tagId];
    ctx.onPatch(task.id, { tag_ids: next });
  }

  return (
    <Popover>
      <PopoverTrigger render={<button className={CELL_BUTTON} />}>{label}</PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-1">
        {ctx.tags.map((t) => (
          <button
            key={t.id}
            onClick={() => toggle(t.id)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
            <span className="flex-1 truncate text-left">{t.name}</span>
            {current.has(t.id) && <Check className="size-3.5 shrink-0" />}
          </button>
        ))}
        {ctx.tags.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Тегов пока нет</p>}
      </PopoverContent>
    </Popover>
  );
});

// --- Начало ---------------------------------------------------------------------------

export const StartCell = memo(function StartCell({ task, ctx }: { task: TaskRow; ctx: CellContext }) {
  const label = task.start_date ? (
    <span className="truncate text-xs tabular-nums">{formatShortDate(task.start_date)}</span>
  ) : null;

  if (!ctx.canEdit) return <ReadOnly>{label}</ReadOnly>;

  return (
    <DatePicker
      date={task.start_date}
      triggerClassName={CELL_BUTTON}
      onCommit={(start_date) => ctx.onPatch(task.id, { start_date })}
    >
      {label}
    </DatePicker>
  );
});

// --- Дедлайн --------------------------------------------------------------------------

export const DueCell = memo(function DueCell({ task, ctx }: { task: TaskRow; ctx: CellContext }) {
  const text = formatDue(task.due_date, task.due_time);
  const label = text ? (
    <span className={cn("truncate text-xs tabular-nums", dueTone(task.due_date, !!task.completed_at))}>{text}</span>
  ) : null;

  if (!ctx.canEdit) return <ReadOnly>{label}</ReadOnly>;

  return (
    <DuePicker
      date={task.due_date}
      time={task.due_time}
      triggerClassName={CELL_BUTTON}
      onCommit={(next) => ctx.onPatch(task.id, next)}
    >
      {label}
    </DuePicker>
  );
});

// --- Оценка ---------------------------------------------------------------------------

const ESTIMATE_PRESETS = [15, 30, 60, 120, 240, 480];

export const EstimateCell = memo(function EstimateCell({ task, ctx }: { task: TaskRow; ctx: CellContext }) {
  const label =
    task.estimated_minutes == null ? null : (
      <span className="truncate text-xs tabular-nums">{formatEstimate(task.estimated_minutes)}</span>
    );
  if (!ctx.canEdit) return <ReadOnly>{label}</ReadOnly>;

  return (
    <Popover>
      <PopoverTrigger render={<button className={CELL_BUTTON} />}>{label}</PopoverTrigger>
      <PopoverContent align="start" className="w-52 gap-2 p-2.5">
        <div className="flex flex-wrap gap-1">
          {ESTIMATE_PRESETS.map((m) => (
            <button
              key={m}
              onClick={() => ctx.onPatch(task.id, { estimated_minutes: m })}
              className={cn(
                "rounded border border-border px-2 py-1 text-xs hover:bg-muted",
                task.estimated_minutes === m && "border-primary bg-primary/10 text-primary",
              )}
            >
              {formatEstimate(m)}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Минут
          <input
            type="number"
            min={0}
            step={5}
            defaultValue={task.estimated_minutes ?? ""}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const next = raw === "" ? null : Math.max(0, Number(raw));
              if (next !== task.estimated_minutes) ctx.onPatch(task.id, { estimated_minutes: next });
            }}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring"
          />
        </label>
        {task.estimated_minutes != null && (
          <button
            onClick={() => ctx.onPatch(task.id, { estimated_minutes: null })}
            className="flex items-center gap-1.5 rounded px-1 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" /> Убрать оценку
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
});

// --- Счётчики -------------------------------------------------------------------------

export const SubtasksCell = memo(function SubtasksCell({ task }: { task: TaskRow }) {
  if (task.subtask_count === 0) return <ReadOnly />;
  const done = task.subtask_done_count === task.subtask_count;
  return (
    <ReadOnly>
      <span className={cn("text-xs tabular-nums", done ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
        {task.subtask_done_count}/{task.subtask_count}
      </span>
    </ReadOnly>
  );
});

export const CommentsCell = memo(function CommentsCell({ task }: { task: TaskRow }) {
  if (task.comment_count === 0) return <ReadOnly />;
  return (
    <ReadOnly>
      <MessageSquare className="size-3 text-muted-foreground" />
      <span className="text-xs tabular-nums text-muted-foreground">{task.comment_count}</span>
    </ReadOnly>
  );
});

export const PlainDateCell = memo(function PlainDateCell({ iso }: { iso: string }) {
  return (
    <ReadOnly>
      <span className="truncate text-xs text-muted-foreground">{formatShortDate(iso)}</span>
    </ReadOnly>
  );
});

/** Значение кастомного поля — только для чтения: правка живёт в карточке. */
export const CustomFieldCell = memo(function CustomFieldCell({ value }: { value: unknown }) {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return <ReadOnly />;
  }
  if (typeof value === "boolean") {
    return <ReadOnly>{value && <Check className="size-3.5 text-emerald-600" />}</ReadOnly>;
  }
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  return (
    <ReadOnly>
      <span className="truncate text-xs" title={text}>
        {text}
      </span>
    </ReadOnly>
  );
});
