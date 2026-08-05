"use client";

// Диалоги спринта: старт с предупреждениями, завершение со списком незакрытых и
// перенос задач с решением про сроки.
//
// Все три считают итог теми же чистыми функциями, что и сервер
// (`sprint-model.ts`): диалог обещает «станет 34 из 40 ч» и обязан не разойтись
// с тем, что после нажатия сделает `sprints.ts`.

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatEstimate } from "@/components/v2/tasks/cells";
import {
  carryDefault,
  dueBeforeSprintEnd,
  shouldShiftDates,
  sprintDelta,
  sprintLoad,
  type CarryTarget,
} from "@/lib/core/sprint-model";
import type { Sprint, SprintWithTotals, TaskRow, TaskStatus } from "@/lib/core/types";
import { cn } from "@/lib/utils";

/** Сумма оценок; задачи без оценки в неё не попадают — о них говорим отдельно. */
export function totalEstimate(tasks: Array<Pick<TaskRow, "estimated_minutes">>): number {
  return tasks.reduce((sum, t) => sum + (t.estimated_minutes ?? 0), 0);
}

function LoadLine({ minutes, capacity }: { minutes: number; capacity: number | null }) {
  const load = sprintLoad({ estimated_minutes: minutes, capacity_minutes: capacity });
  return (
    <span className={cn("tabular-nums font-medium", load.over && "text-destructive")}>
      {formatEstimate(minutes)}
      {capacity ? ` из ${formatEstimate(capacity)}` : ""}
    </span>
  );
}

function Warning({
  icon: Icon,
  title,
  children,
  danger,
}: {
  icon: typeof AlertTriangle;
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-lg p-2.5 text-xs leading-relaxed",
        danger ? "bg-destructive/10" : "bg-amber-500/10",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", danger ? "text-destructive" : "text-amber-600")} />
      <span>
        <b className="block">{title}</b>
        {children}
      </span>
    </div>
  );
}

// --- Старт --------------------------------------------------------------------------

/**
 * Проверки перед стартом — предупреждения, а не запреты: контекст команда знает
 * лучше программы, и кнопка «Начать» остаётся активной. Молчать о них нельзя:
 * «набрано 28 из 40 ч» не учитывает задачи без оценки, а задача, заблокированная
 * задачей вне спринта, не начнётся вовсе.
 */
export function StartSprintDialog({
  open,
  onOpenChange,
  sprint,
  tasks,
  blockedByOutside,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sprint: Sprint;
  tasks: TaskRow[];
  /** Задачи спринта, которые ждут задачу вне его состава: id → название блокера. */
  blockedByOutside: Array<{ task: TaskRow; blockerTitle: string }>;
  busy: boolean;
  onConfirm: () => void;
}) {
  const unestimated = tasks.filter((t) => t.estimated_minutes == null);
  const unassigned = tasks.filter((t) => t.assignees.length === 0);
  const minutes = totalEstimate(tasks);
  const load = sprintLoad({ estimated_minutes: minutes, capacity_minutes: sprint.capacity_minutes });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Начать «{sprint.name}»</DialogTitle>
          <DialogDescription>
            {tasks.length} задач · набрано <LoadLine minutes={minutes} capacity={sprint.capacity_minutes} />
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {unestimated.length > 0 && (
            <Warning icon={AlertTriangle} title={`${unestimated.length} задач без оценки`}>
              Набранные {formatEstimate(minutes)} их не учитывают — реальный объём больше.
            </Warning>
          )}
          {unassigned.length > 0 && (
            <Warning icon={AlertTriangle} title={`${unassigned.length} задач без исполнителя`}>
              Напоминание о сроке приходит только исполнителю — этим задачам напомнить некому.
            </Warning>
          )}
          {blockedByOutside.map(({ task, blockerTitle }) => (
            <Warning key={task.id} icon={Lock} title="Задача заблокирована извне" danger>
              «{task.title}» ждёт «{blockerTitle}» — этой задачи в спринте нет.
            </Warning>
          ))}
          {load.over && (
            <Warning icon={AlertTriangle} title="Спринт перегружен">
              Набрано {formatEstimate(minutes)} при ёмкости {formatEstimate(load.capacity ?? 0)}.
            </Warning>
          )}
          {unestimated.length === 0 && unassigned.length === 0 && blockedByOutside.length === 0 && !load.over && (
            <p className="text-xs text-muted-foreground">Всё на месте: оценки, исполнители и зависимости.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Предупреждения старт не блокируют — они о том, что стоит поправить, а не о запрете.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            Начать спринт
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Завершение ----------------------------------------------------------------------

export interface CompleteDecision {
  task_id: string;
  target: CarryTarget;
}

/**
 * Завершение: список незакрытых с умолчанием по категории статуса. Начатую
 * задачу предлагаем взять в следующий спринт, не начатую — вернуть в бэклог;
 * каждую строку можно перещёлкнуть, а итог целевого спринта считается сразу —
 * иначе задачи переносят вслепую в уже полный спринт.
 */
export function CompleteSprintDialog({
  open,
  onOpenChange,
  sprint,
  leftovers,
  statuses,
  targets,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sprint: SprintWithTotals;
  leftovers: TaskRow[];
  statuses: TaskStatus[];
  /** Куда можно перенести: незавершённые спринты того же проекта. */
  targets: SprintWithTotals[];
  busy: boolean;
  onConfirm: (input: { carry_to: string | null; decisions: CompleteDecision[]; shift_dates: boolean }) => void;
}) {
  const categoryOf = useMemo(() => {
    const map = new Map(statuses.map((s) => [s.id, s.category]));
    return (task: TaskRow) => (task.status_id ? map.get(task.status_id) : undefined);
  }, [statuses]);

  const [carryTo, setCarryTo] = useState<string | null>(targets[0]?.id ?? null);
  const [choices, setChoices] = useState<Record<string, CarryTarget>>({});
  const [shiftDates, setShiftDates] = useState(true);

  const targetSprint = targets.find((s) => s.id === carryTo) ?? null;
  const decisionOf = (task: TaskRow): CarryTarget =>
    choices[task.id] ?? (targetSprint ? carryDefault(categoryOf(task)) : "backlog");

  const carried = leftovers.filter((t) => decisionOf(t) === "sprint");
  const returned = leftovers.filter((t) => decisionOf(t) !== "sprint");
  const targetMinutes = targetSprint ? targetSprint.estimated_minutes + totalEstimate(carried) : 0;

  const done = sprint.done_count;
  const total = sprint.task_count;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Завершить «{sprint.name}»</DialogTitle>
          <DialogDescription>
            Закрыто {done} из {total} задач. Осталось {leftovers.length} незакрытых: начатые предлагаем
            взять в следующий спринт, не начатые — вернуть в бэклог.
          </DialogDescription>
        </DialogHeader>

        {targets.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Переносить в
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
              value={carryTo ?? ""}
              onChange={(e) => setCarryTo(e.target.value || null)}
            >
              {targets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="">— только в бэклог —</option>
            </select>
          </label>
        )}

        <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
          {leftovers.length === 0 && (
            <p className="p-3 text-xs text-muted-foreground">Незакрытых задач нет — спринт закрыт полностью.</p>
          )}
          {leftovers.map((task) => {
            const choice = decisionOf(task);
            return (
              <div
                key={task.id}
                className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                {task.sprint_carry_count > 0 && (
                  <span
                    className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                    title="Задача уже переезжала из спринта в спринт"
                  >
                    {task.sprint_carry_count + 1}-й спринт
                  </span>
                )}
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatEstimate(task.estimated_minutes)}
                </span>
                <div className="flex shrink-0 overflow-hidden rounded-md border border-input">
                  <button
                    type="button"
                    disabled={!targetSprint}
                    onClick={() => setChoices((c) => ({ ...c, [task.id]: "sprint" }))}
                    className={cn(
                      "px-2 py-1 text-[11px] font-medium disabled:opacity-40",
                      choice === "sprint" ? "bg-foreground text-background" : "text-muted-foreground",
                    )}
                  >
                    {targetSprint ? `В ${targetSprint.name}` : "В спринт"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setChoices((c) => ({ ...c, [task.id]: "backlog" }))}
                    className={cn(
                      "px-2 py-1 text-[11px] font-medium",
                      choice !== "sprint" ? "bg-foreground text-background" : "text-muted-foreground",
                    )}
                  >
                    В бэклог
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          {targetSprint ? (
            <>
              {targetSprint.name} после переноса:{" "}
              <LoadLine minutes={targetMinutes} capacity={targetSprint.capacity_minutes} />
              {" · "}
            </>
          ) : null}
          в бэклог вернётся {returned.length}
        </div>

        {targetSprint && carried.length > 0 && (
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <Checkbox checked={shiftDates} onCheckedChange={(v) => setShiftDates(v === true)} />
            <span>
              Сдвинуть сроки переезжающих задач на новый спринт
              {sprint.starts_on && targetSprint.starts_on
                ? ` (+${sprintDelta(sprint, targetSprint)} дней)`
                : ""}
              <span className="mt-0.5 block text-muted-foreground">
                Сдвигаются только сроки, стоявшие внутри «{sprint.name}». Дедлайны за его пределами —
                чужая договорённость, их не трогаем.
              </span>
            </span>
          </label>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              onConfirm({
                carry_to: targetSprint?.id ?? null,
                decisions: leftovers.map((t) => ({ task_id: t.id, target: decisionOf(t) })),
                shift_dates: shiftDates,
              })
            }
          >
            Завершить спринт
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Перенос -------------------------------------------------------------------------

/**
 * Перенос задач в спринт. Сроки не двигаются молча: галочка приходит включённой
 * только тогда, когда срок стоял внутри исходного спринта — то есть выглядит как
 * план команды, а не как обещание кому-то снаружи.
 */
export function MoveToSprintDialog({
  open,
  onOpenChange,
  tasks,
  sprintOf,
  target,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: TaskRow[];
  /** Исходный спринт задачи (у каждой свой) — `null`, если она была в бэклоге. */
  sprintOf: (task: TaskRow) => Sprint | null;
  target: SprintWithTotals | null;
  busy: boolean;
  onConfirm: (shiftDates: boolean) => void;
}) {
  const shiftable = tasks.filter((t) => shouldShiftDates(t, sprintOf(t)));
  const [shiftDates, setShiftDates] = useState(true);
  // Задачи со сроком вне исходного спринта: их даты остаются как есть, но если
  // срок наступит раньше конца нового спринта — это надо сказать вслух.
  const conflicts = tasks.filter(
    (t) => !shouldShiftDates(t, sprintOf(t)) && dueBeforeSprintEnd(t, target),
  );
  const minutes = totalEstimate(tasks);
  const targetMinutes = (target?.estimated_minutes ?? 0) + minutes;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {target ? `Перенести в «${target.name}»` : "Вернуть в бэклог"}
            {tasks.length > 1 ? ` · ${tasks.length} задач` : ""}
          </DialogTitle>
          {target && (
            <DialogDescription>
              {target.name} станет <LoadLine minutes={targetMinutes} capacity={target.capacity_minutes} />
            </DialogDescription>
          )}
        </DialogHeader>

        {target && shiftable.length > 0 && (
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <Checkbox checked={shiftDates} onCheckedChange={(v) => setShiftDates(v === true)} />
            <span>
              Сдвинуть сроки на новый спринт
              <span className="mt-0.5 block text-muted-foreground">
                {shiftable.length === 1
                  ? `Срок задачи «${shiftable[0].title}» стоял внутри прежнего спринта — поэтому едет вместе с ней.`
                  : `У ${shiftable.length} задач срок стоял внутри прежнего спринта — они едут вместе с задачами.`}
              </span>
            </span>
          </label>
        )}

        {conflicts.map((task) => (
          <Warning key={task.id} icon={CalendarClock} title={`«${task.title}» — срок ${task.due_date}`} danger>
            Он вне прежнего спринта, похоже на внешнюю договорённость: оставляем как есть. Учтите, что он
            наступит раньше конца «{target?.name}».
          </Warning>
        ))}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button disabled={busy} onClick={() => onConfirm(shiftDates && shiftable.length > 0)}>
            {target ? "Перенести" : "Вернуть в бэклог"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
