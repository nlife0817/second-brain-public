"use client";

// Вид «Бэклог» — он же экран планирования проекта в режиме «Разработка».
// Сверху сложены спринты, снизу ранжированный бэклог; задачи перетаскиваются
// между ними, и это и есть планирование — отдельного экрана для него нет.
//
// Что важно не потерять при правках:
//  - фильтры, поиск и представления здесь общие с таблицей и доской
//    (`visiblePool`/`filterTasks`), иначе один и тот же фильтр показывал бы в
//    двух видах разные задачи;
//  - итоги спринтов считаются по загруженному списку задач, а не по ответу
//    сервера: перетаскивание должно менять «набрано» сразу, а не после
//    перечитывания экрана;
//  - порядок бэклога — это `task_projects.position` (та же колонка, по которой
//    сортирует список проекта), поэтому ранг переживает переезд задачи в спринт
//    и обратно.

import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronDown, GripVertical, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatEstimate } from "@/components/v2/tasks/cells";
import {
  CompleteSprintDialog,
  estimateLabel,
  MoveToSprintDialog,
  StartSprintDialog,
  totalEstimate,
  type CompleteDecision,
} from "@/components/v2/tasks/SprintDialogs";
import { FilterButton, TaskCount, TaskSearch } from "@/components/v2/tasks/ViewToolbar";
import { api } from "@/lib/core/client";
import {
  BACKLOG_ZONE,
  daysLeft,
  dropAction,
  rowZone,
  shiftTaskDates,
  sprintLoad,
  SPRINT_STATE_LABELS,
} from "@/lib/core/sprint-model";
import type { Sprint, SprintWithTotals, TaskRow, TaskStatus, UserBrief } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { useViewStore } from "@/lib/core/view-store";
import { filterTasks, makeMatchContext, visiblePool } from "@/lib/core/views";
import { cn } from "@/lib/utils";

/** Сколько строк показывает секция сразу — тот же предел, что у колонок доски. */
const SECTION_PAGE = 50;

export interface BacklogViewProps {
  projectId: string;
  tasks: TaskRow[];
  setTasks: React.Dispatch<React.SetStateAction<TaskRow[]>>;
  sprints: SprintWithTotals[];
  setSprints: React.Dispatch<React.SetStateAction<SprintWithTotals[]>>;
  canEdit: boolean;
  onOpenTask: (id: string) => void;
  reload: () => Promise<void> | void;
  titleSlot: React.ReactNode;
  actionsSlot: React.ReactNode;
}

export function BacklogView({
  projectId,
  tasks,
  setTasks,
  sprints,
  setSprints,
  canEdit,
  onOpenTask,
  reload,
  titleSlot,
  actionsSlot,
}: BacklogViewProps) {
  const { orgId, statuses, me } = useV2Store();
  const filterGroups = useViewStore((s) => s.groups);
  const search = useViewStore((s) => s.search);

  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [startFor, setStartFor] = useState<SprintWithTotals | null>(null);
  const [completeFor, setCompleteFor] = useState<SprintWithTotals | null>(null);
  const [move, setMove] = useState<{ tasks: TaskRow[]; target: SprintWithTotals | null } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Отсев тот же, что у таблицы и доски: «Готово» и «Архив» скрыты, пока их не
  // попросят показать, а фильтры и поиск приходят из общего стора.
  const matchCtx = useMemo(() => makeMatchContext(me?.id ?? null), [me?.id]);
  const pool = useMemo(() => visiblePool(tasks, filterGroups, statuses), [tasks, filterGroups, statuses]);
  const shown = useMemo(
    () => filterTasks(pool, filterGroups, search, matchCtx),
    [pool, filterGroups, search, matchCtx],
  );

  // Подзадачи в планировании не участвуют самостоятельно, пока их родитель в
  // этом же проекте: иначе одна работа считалась бы дважды.
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const planned = useMemo(
    () => shown.filter((t) => !t.parent_task_id || !byId.has(t.parent_task_id)),
    [shown, byId],
  );

  const bySprint = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    const backlog: TaskRow[] = [];
    for (const task of planned) {
      if (!task.sprint_id) {
        backlog.push(task);
        continue;
      }
      const list = map.get(task.sprint_id) ?? [];
      list.push(task);
      map.set(task.sprint_id, list);
    }
    // Порядок бэклога задаёт человек — позиция размещения в этом проекте.
    backlog.sort((a, b) => positionIn(a, projectId) - positionIn(b, projectId));
    return { map, backlog };
  }, [planned, projectId]);

  const sprintOf = useCallback(
    (task: TaskRow): Sprint | null => sprints.find((s) => s.id === task.sprint_id) ?? null,
    [sprints],
  );

  const sprintPath = orgId ? `/orgs/${orgId}/sprints` : null;

  const withBusy = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не получилось");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const addSprint = useCallback(async () => {
    if (!orgId) return;
    await withBusy(async () => {
      const created = await api.post<SprintWithTotals>(`/orgs/${orgId}/projects/${projectId}/sprints`, {});
      setSprints((prev) => [...prev, { ...created, task_count: 0, done_count: 0, estimated_minutes: 0, unestimated_count: 0 }]);
    });
  }, [orgId, projectId, setSprints, withBusy]);

  /**
   * Перенос задач. Сроки считает та же чистая `shiftTaskDates`, что применил бы
   * сервер при завершении спринта, и уходят они обычными полями патча: отдельного
   * «сдвинь заодно даты» у задачи нет — иначе один PATCH молча менял бы дату, о
   * которой человек с кем-то договорился.
   */
  const applyMove = useCallback(
    async (moved: TaskRow[], target: SprintWithTotals | null, shiftDates: boolean) => {
      if (!orgId) return;
      await withBusy(async () => {
        for (const task of moved) {
          const from = sprintOf(task);
          const dates = shiftDates ? shiftTaskDates(task, from, target) : null;
          const patch: Record<string, unknown> = { sprint_id: target?.id ?? null };
          if (dates && (dates.start_date !== task.start_date || dates.due_date !== task.due_date)) {
            patch.start_date = dates.start_date;
            patch.due_date = dates.due_date;
          }
          await api.patch(`/orgs/${orgId}/tasks/${task.id}`, patch);
          setTasks((prev) =>
            prev.map((t) =>
              t.id === task.id
                ? {
                    ...t,
                    sprint_id: target?.id ?? null,
                    start_date: dates ? dates.start_date : t.start_date,
                    due_date: dates ? dates.due_date : t.due_date,
                  }
                : t,
            ),
          );
        }
      });
    },
    [orgId, setTasks, sprintOf, withBusy],
  );

  /** Ранжирование бэклога: позиция между соседями, как на доске. */
  const reorderBacklog = useCallback(
    async (taskId: string, beforeTaskId: string | null) => {
      if (!orgId) return;
      const list = bySprint.backlog.filter((t) => t.id !== taskId);
      const index = beforeTaskId ? list.findIndex((t) => t.id === beforeTaskId) : list.length;
      const prev = index > 0 ? positionIn(list[index - 1], projectId) : 0;
      const next = index >= 0 && index < list.length ? positionIn(list[index], projectId) : prev + 2;
      const position = (prev + next) / 2;
      setTasks((all) =>
        all.map((t) =>
          t.id === taskId
            ? { ...t, placements: t.placements.map((p) => (p.project_id === projectId ? { ...p, position } : p)) }
            : t,
        ),
      );
      await withBusy(async () => {
        await api.post(`/orgs/${orgId}/tasks/${taskId}/move`, { project_id: projectId, position });
      });
    },
    [orgId, projectId, bySprint.backlog, setTasks, withBusy],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragId(null);
      const task = tasks.find((t) => t.id === String(event.active.id));
      if (!task) return;
      // Что означает бросок — правило, а не жест: оно живёт в sprint-model и
      // покрыто тестом, потому что сам dnd-kit в тестах не воспроизвести.
      const action = dropAction(task, event.over ? String(event.over.id) : null);
      if (action.kind === "none") return;

      if (action.kind === "reorder") {
        if (action.leaveSprint) {
          void applyMove([task], null, false).then(() => reorderBacklog(task.id, action.beforeTaskId));
          return;
        }
        void reorderBacklog(task.id, action.beforeTaskId);
        return;
      }

      const target = action.sprintId ? sprints.find((s) => s.id === action.sprintId) ?? null : null;
      // Диалог показываем только там, где есть о чём спросить: возврат в бэклог
      // сроков не двигает, и подтверждать в нём нечего.
      if (target) setMove({ tasks: [task], target });
      else void applyMove([task], null, false);
    },
    [tasks, sprints, applyMove, reorderBacklog],
  );

  const onDragStart = useCallback((event: DragStartEvent) => setDragId(String(event.active.id)), []);

  const startSprint = useCallback(
    async (sprint: SprintWithTotals) => {
      if (!sprintPath) return;
      await withBusy(async () => {
        const updated = await api.post<Sprint>(`${sprintPath}/${sprint.id}/start`);
        setSprints((prev) => prev.map((s) => (s.id === sprint.id ? { ...s, ...updated } : s)));
        setStartFor(null);
      });
    },
    [sprintPath, setSprints, withBusy],
  );

  const completeSprint = useCallback(
    async (
      sprint: SprintWithTotals,
      input: { carry_to: string | null; decisions: CompleteDecision[]; shift_dates: boolean },
    ) => {
      if (!sprintPath) return;
      await withBusy(async () => {
        await api.post(`${sprintPath}/${sprint.id}/complete`, input);
        setCompleteFor(null);
        // Перенос затронул сразу много задач и сроки части из них — здесь
        // локальная догадка обошлась бы дороже честного перечитывания.
        await reload();
      });
    },
    [sprintPath, reload, withBusy],
  );

  const dragging = dragId ? tasks.find((t) => t.id === dragId) ?? null : null;
  const openSprints = sprints.filter((s) => s.state !== "completed");
  const leftoversOf = (sprint: SprintWithTotals) =>
    (bySprint.map.get(sprint.id) ?? []).filter((t) => !t.completed_at);
  // Итоги считаем по загруженному списку, а не по ответу сервера: перетаскивание
  // должно менять «набрано» сразу, а серверные totals остались бы вчерашними.
  const minutesOf = useCallback(
    (sprintId: string) => totalEstimate(bySprint.map.get(sprintId) ?? []),
    [bySprint],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        {titleSlot}
        <TaskCount shown={shown.length} total={pool.length} />
        <TaskSearch />
        <FilterButton />
        <span className="flex-1" />
        {actionsSlot}
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => void addSprint()} disabled={busy}>
            <Plus className="size-3.5" />
            Спринт
          </Button>
        )}
      </header>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-2">
            {openSprints.map((sprint) => (
              <SprintCard
                key={sprint.id}
                sprint={sprint}
                tasks={bySprint.map.get(sprint.id) ?? []}
                statuses={statuses}
                collapsed={collapsed.includes(sprint.id)}
                canEdit={canEdit}
                busy={busy}
                onToggle={() =>
                  setCollapsed((prev) =>
                    prev.includes(sprint.id) ? prev.filter((id) => id !== sprint.id) : [...prev, sprint.id],
                  )
                }
                onOpenTask={onOpenTask}
                onStart={() => setStartFor(sprint)}
                onComplete={() => setCompleteFor(sprint)}
                onFill={() => {
                  const remaining = sprintLoad({
                    estimated_minutes: totalEstimate(bySprint.map.get(sprint.id) ?? []),
                    capacity_minutes: sprint.capacity_minutes,
                  }).remaining;
                  const picked = pickToFill(bySprint.backlog, remaining);
                  if (picked.length > 0) setMove({ tasks: picked, target: sprint });
                }}
              />
            ))}
            {openSprints.length === 0 && (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                Спринтов пока нет. Заведите первый — задачи из бэклога можно будет перетащить в него.
              </p>
            )}
          </div>

          <BacklogSection
            tasks={bySprint.backlog}
            statuses={statuses}
            canEdit={canEdit}
            sprints={openSprints}
            onOpenTask={onOpenTask}
            onMove={(task, target) => setMove({ tasks: [task], target })}
          />
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <div className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs shadow-md">
              {dragging.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {startFor && (
        <StartSprintDialog
          open
          onOpenChange={(open) => !open && setStartFor(null)}
          sprint={startFor}
          tasks={bySprint.map.get(startFor.id) ?? []}
          blockedByOutside={[]}
          busy={busy}
          onConfirm={() => void startSprint(startFor)}
        />
      )}

      {completeFor && (
        <CompleteSprintDialog
          open
          onOpenChange={(open) => !open && setCompleteFor(null)}
          sprint={completeFor}
          sprintTasks={bySprint.map.get(completeFor.id) ?? []}
          leftovers={leftoversOf(completeFor)}
          statuses={statuses}
          targets={openSprints.filter((s) => s.id !== completeFor.id)}
          minutesOf={minutesOf}
          busy={busy}
          onConfirm={(input) => void completeSprint(completeFor, input)}
        />
      )}

      {move && (
        <MoveToSprintDialog
          open
          onOpenChange={(open) => !open && setMove(null)}
          tasks={move.tasks}
          sprintOf={sprintOf}
          target={move.target}
          targetMinutes={move.target ? minutesOf(move.target.id) : 0}
          busy={busy}
          onConfirm={(shiftDates) => {
            const { tasks: moved, target } = move;
            setMove(null);
            void applyMove(moved, target, shiftDates);
          }}
        />
      )}
    </div>
  );
}

// --- Спринт ---------------------------------------------------------------------------

function SprintCard({
  sprint,
  tasks,
  statuses,
  collapsed,
  canEdit,
  busy,
  onToggle,
  onOpenTask,
  onStart,
  onComplete,
  onFill,
}: {
  sprint: SprintWithTotals;
  tasks: TaskRow[];
  statuses: TaskStatus[];
  collapsed: boolean;
  canEdit: boolean;
  busy: boolean;
  onToggle: () => void;
  onOpenTask: (id: string) => void;
  onStart: () => void;
  onComplete: () => void;
  onFill: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: sprint.id });
  const minutes = totalEstimate(tasks);
  const load = sprintLoad({ estimated_minutes: minutes, capacity_minutes: sprint.capacity_minutes });
  const left = sprint.state === "active" ? daysLeft(sprint, todayIso()) : null;
  const done = tasks.filter((t) => t.completed_at).length;

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "rounded-xl border bg-background",
        sprint.state === "active" ? "border-primary/40" : "border-border",
        isOver && "ring-2 ring-primary/40",
      )}
    >
      <header className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button onClick={onToggle} className="flex items-center gap-2 text-left" title="Свернуть спринт">
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", collapsed && "-rotate-90")} />
          <span className="text-sm font-semibold">{sprint.name}</span>
        </button>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold",
            sprint.state === "active" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {SPRINT_STATE_LABELS[sprint.state]}
        </span>
        {sprint.starts_on && sprint.ends_on && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {shortDate(sprint.starts_on)} — {shortDate(sprint.ends_on)}
          </span>
        )}
        {left !== null && (
          <span className={cn("text-xs", left < 0 ? "text-destructive" : "text-muted-foreground")}>
            {left < 0 ? `просрочен на ${-left} дн.` : `осталось ${left} дн.`}
          </span>
        )}
        <span className="flex-1" />

        <span className="flex flex-col items-end gap-1">
          <span className="text-[11px] tabular-nums text-muted-foreground">
            <span className={cn(load.over && "font-semibold text-destructive")}>{estimateLabel(minutes)}</span>
            {sprint.capacity_minutes ? ` из ${formatEstimate(sprint.capacity_minutes)}` : ""}
            {tasks.length > 0 && ` · ${done}/${tasks.length} закрыто`}
          </span>
          {sprint.capacity_minutes ? (
            <span className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
              <span
                className={cn("block h-full rounded-full", load.over ? "bg-destructive" : "bg-primary")}
                style={{ width: `${Math.min(100, Math.round((load.ratio ?? 0) * 100))}%` }}
              />
            </span>
          ) : null}
        </span>

        {canEdit && sprint.state === "planned" && (
          <>
            {sprint.capacity_minutes ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={onFill}
                disabled={busy}
                title="Взять из бэклога сверху, пока хватает остатка"
              >
                <Sparkles className="size-3.5" />
                Дозаполнить
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={onStart} disabled={busy}>
              Начать
            </Button>
          </>
        )}
        {canEdit && sprint.state === "active" && (
          <Button size="sm" variant="outline" onClick={onComplete} disabled={busy}>
            Завершить
          </Button>
        )}
      </header>

      {!collapsed && (
        <div className="border-t border-border/60">
          {tasks.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              Перетащите сюда задачи из бэклога — спринт пуст.
            </p>
          ) : (
            <TaskLines tasks={tasks} statuses={statuses} canEdit={canEdit} onOpenTask={onOpenTask} />
          )}
        </div>
      )}
    </section>
  );
}

// --- Бэклог ---------------------------------------------------------------------------

function BacklogSection({
  tasks,
  statuses,
  canEdit,
  sprints,
  onOpenTask,
  onMove,
}: {
  tasks: TaskRow[];
  statuses: TaskStatus[];
  canEdit: boolean;
  sprints: SprintWithTotals[];
  onOpenTask: (id: string) => void;
  onMove: (task: TaskRow, target: SprintWithTotals) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: BACKLOG_ZONE });
  return (
    <section
      ref={setNodeRef}
      className={cn("mt-4 rounded-xl border border-border bg-background", isOver && "ring-2 ring-primary/40")}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        <h2 className="text-sm font-semibold">Бэклог</h2>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
          {tasks.length}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {estimateLabel(totalEstimate(tasks))} · порядок задаёте перетаскиванием
        </span>
      </header>
      <div className="border-t border-border/60">
        {tasks.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">Бэклог пуст.</p>
        ) : (
          <TaskLines
            tasks={tasks}
            statuses={statuses}
            canEdit={canEdit}
            onOpenTask={onOpenTask}
            sprints={sprints}
            onMove={onMove}
            sortable
          />
        )}
      </div>
    </section>
  );
}

// --- Строки ------------------------------------------------------------------------------

function TaskLines({
  tasks,
  statuses,
  canEdit,
  onOpenTask,
  sprints,
  onMove,
  sortable,
}: {
  tasks: TaskRow[];
  statuses: TaskStatus[];
  canEdit: boolean;
  onOpenTask: (id: string) => void;
  sprints?: SprintWithTotals[];
  onMove?: (task: TaskRow, target: SprintWithTotals) => void;
  sortable?: boolean;
}) {
  const [limit, setLimit] = useState(SECTION_PAGE);
  const statusOf = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const visible = tasks.length > limit ? tasks.slice(0, limit) : tasks;
  const rest = tasks.length - visible.length;

  return (
    <>
      {visible.map((task) => (
        <TaskLine
          key={task.id}
          task={task}
          status={task.status_id ? statusOf.get(task.status_id) : undefined}
          canEdit={canEdit}
          onOpen={onOpenTask}
          sprints={sprints}
          onMove={onMove}
          sortable={sortable}
        />
      ))}
      {rest > 0 && (
        <button
          onClick={() => setLimit((l) => l + SECTION_PAGE)}
          className="w-full py-2 text-center text-xs text-muted-foreground hover:bg-muted/60"
        >
          Показать ещё {Math.min(SECTION_PAGE, rest)} · осталось {rest}
        </button>
      )}
    </>
  );
}

function TaskLine({
  task,
  status,
  canEdit,
  onOpen,
  sprints,
  onMove,
  sortable,
}: {
  task: TaskRow;
  status: TaskStatus | undefined;
  canEdit: boolean;
  onOpen: (id: string) => void;
  sprints?: SprintWithTotals[];
  onMove?: (task: TaskRow, target: SprintWithTotals) => void;
  sortable?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !canEdit });
  // Строка бэклога — ещё и место вставки: бросок на неё ставит задачу перед ней.
  // Отдельного sortable-пакета для этого не нужно.
  const drop = useDroppable({ id: rowZone(task.id), disabled: !sortable });

  return (
    <div
      ref={sortable ? drop.setNodeRef : undefined}
      className={cn(
        "flex items-center gap-2 border-b border-border/50 px-3 py-1.5 text-xs last:border-b-0 hover:bg-muted/50",
        isDragging && "opacity-40",
        sortable && drop.isOver && "border-t-2 border-t-primary",
      )}
    >
      {canEdit && (
        <button
          ref={setNodeRef}
          {...listeners}
          {...attributes}
          className="cursor-grab text-muted-foreground/60 hover:text-foreground"
          title="Перетащить"
        >
          <GripVertical className="size-3.5" />
        </button>
      )}
      <button
        onClick={() => onOpen(task.id)}
        className={cn("min-w-0 flex-1 truncate text-left", task.completed_at && "text-muted-foreground line-through")}
      >
        {task.title}
      </button>
      {task.sprint_carry_count > 0 && (
        <span
          className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
          title="Задача уже переезжала из спринта в спринт — стоит разбить её или передать"
        >
          {task.sprint_carry_count + 1}-й спринт
        </span>
      )}
      {status && (
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px]"
          style={{ backgroundColor: `${status.color}22`, color: status.color }}
        >
          {status.name}
        </span>
      )}
      <Assignees users={task.assignees} />
      <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
        {formatEstimate(task.estimated_minutes)}
      </span>
      {canEdit && sprints && onMove && sprints.length > 0 && (
        <select
          className="h-6 shrink-0 rounded border border-input bg-background px-1 text-[11px] text-muted-foreground"
          value=""
          onChange={(e) => {
            const target = sprints.find((s) => s.id === e.target.value);
            if (target) onMove(task, target);
          }}
          title="Взять в спринт"
        >
          <option value="">В спринт…</option>
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function Assignees({ users }: { users: UserBrief[] }) {
  if (users.length === 0) return <span className="w-6 shrink-0" />;
  return (
    <span className="flex w-6 shrink-0 justify-end" title={users.map((u) => u.name || u.email).join(", ")}>
      <span className="grid size-5 place-items-center rounded bg-muted text-[9px] font-semibold uppercase">
        {initials(users[0])}
      </span>
    </span>
  );
}

// --- Мелочи --------------------------------------------------------------------------------

function positionIn(task: TaskRow, projectId: string): number {
  return task.placements.find((p) => p.project_id === projectId)?.position ?? Number.MAX_SAFE_INTEGER;
}

/**
 * «Дозаполнить до ёмкости»: берём из бэклога сверху, пока хватает остатка.
 * Неоценённые пропускаем — иначе кнопка молча набивает спринт работой
 * неизвестного объёма, и «набрано 28 из 40» перестаёт что-либо значить.
 */
function pickToFill(backlog: TaskRow[], remaining: number | null): TaskRow[] {
  if (remaining === null) return [];
  const picked: TaskRow[] = [];
  let left = remaining;
  for (const task of backlog) {
    const estimate = task.estimated_minutes;
    if (estimate == null || estimate > left) continue;
    picked.push(task);
    left -= estimate;
  }
  return picked;
}

function initials(user: UserBrief): string {
  const source = user.name || user.email;
  return source.slice(0, 2);
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  return `${Number(day)} ${months[Number(month) - 1]}`;
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
