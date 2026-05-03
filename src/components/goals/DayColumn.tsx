"use client";

import { useEffect, useMemo, useState } from "react";
import { useBrainStore } from "@/lib/store";
import type { GoalFull, ItemWithSubtasks, RelationWithTarget } from "@/types";
import { ChevronRight, ChevronsLeft, Plus, CheckCircle2, Circle, ListChecks, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateGoalDialog } from "./CreateGoalDialog";
import { lookupAxis } from "@/lib/goal-axes";

interface Props {
  parentWeekId: string | null;
  selectedDayGoalId: string | null;
  onSelectDayGoal: (id: string | null) => void;
  levelLabel: string;
  onCollapse?: () => void;
  /** Day-level goals already filtered by GoalsView (parent = selected week, or all if no week). */
  dayGoals: GoalFull[];
}

type Mode = "tasks" | "goals";

function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DayColumn({
  parentWeekId,
  selectedDayGoalId,
  onSelectDayGoal,
  levelLabel,
  onCollapse,
  dayGoals,
}: Props) {
  const items = useBrainStore((s) => s.items);
  const goals = useBrainStore((s) => s.goals);
  const goalAxes = useBrainStore((s) => s.goalAxes);
  const openDetail = useBrainStore((s) => s.openDetail);
  const fetchRelations = useBrainStore((s) => s.fetchRelations);
  const [mode, setMode] = useState<Mode>("tasks");
  const [createOpen, setCreateOpen] = useState(false);
  const [date, setDate] = useState(todayLocalISO());

  const canCreateGoal = parentWeekId !== null;

  // The selected day-goal in the column header (used to render the linked-tasks view inside that goal).
  const selectedDayGoal = selectedDayGoalId ? goals.find((g) => g.id === selectedDayGoalId) ?? null : null;

  // ---------- Tasks view ----------
  // Show tasks scheduled for `date` (matches items.due_date prefix).
  const tasksForDate: ItemWithSubtasks[] = useMemo(() => {
    return items
      .filter((i) => i.status !== "archived" && i.due_date && i.due_date.startsWith(date))
      .sort((a, b) => {
        const at = (a.due_time ?? "00:00") + (a.title ?? "");
        const bt = (b.due_time ?? "00:00") + (b.title ?? "");
        return at.localeCompare(bt);
      });
  }, [items, date]);

  const doneCount = tasksForDate.filter((t) => t.status === "done").length;

  // ---------- Goal-linked tasks (when a day-goal is selected) ----------
  const [linkedRels, setLinkedRels] = useState<RelationWithTarget[]>([]);
  useEffect(() => {
    if (!selectedDayGoalId) {
      setLinkedRels([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const rels = await fetchRelations("goal", selectedDayGoalId);
      if (!cancelled) setLinkedRels(rels.filter((r) => r.target_type === "item"));
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDayGoalId, fetchRelations]);

  return (
    <div className="flex h-full min-w-0 flex-col bg-slate-50/30">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          {levelLabel}
        </span>
        <span className="text-[11px] tabular-nums text-slate-400">
          {mode === "tasks" ? `${doneCount}/${tasksForDate.length}` : dayGoals.length}
        </span>
        <div className="ml-2 flex overflow-hidden rounded-md border border-slate-200">
          <button
            type="button"
            onClick={() => setMode("tasks")}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium uppercase",
              mode === "tasks" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50",
            )}
            title="Задачи на день"
          >
            <ListChecks className="size-3" />
            Задачи
          </button>
          <button
            type="button"
            onClick={() => setMode("goals")}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium uppercase",
              mode === "goals" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50",
            )}
            title="Цели на день"
          >
            <Target className="size-3" />
            Цели
          </button>
        </div>
        {mode === "goals" && (
          <button
            onClick={() => setCreateOpen(true)}
            disabled={!canCreateGoal}
            title={canCreateGoal ? "Создать цель на день" : "Сначала выберите неделю"}
            className={cn(
              "ml-auto flex size-6 items-center justify-center rounded-md text-slate-500 transition",
              canCreateGoal ? "hover:bg-slate-100 hover:text-slate-900" : "cursor-not-allowed opacity-30",
            )}
          >
            <Plus className="size-3.5" />
          </button>
        )}
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Свернуть колонку"
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700",
              mode === "tasks" && "ml-auto",
            )}
          >
            <ChevronsLeft className="size-3.5" />
          </button>
        )}
      </div>

      {mode === "tasks" && (
        <div className="border-b border-slate-100 bg-white px-3 py-1.5">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || todayLocalISO())}
            className="h-7 w-full rounded border border-slate-200 px-2 text-xs text-slate-700"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {mode === "tasks" ? (
          <>
            {tasksForDate.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-slate-400">
                Нет задач на этот день
              </div>
            )}
            {tasksForDate.map((t) => {
              const done = t.status === "done";
              return (
                <button
                  key={t.id}
                  onClick={() => openDetail(t.id)}
                  className={cn(
                    "mb-1 flex w-full items-start gap-1.5 rounded border bg-white px-2 py-1.5 text-left text-xs transition",
                    done ? "border-emerald-100 text-slate-400 line-through" : "border-slate-100 text-slate-800 hover:border-slate-200",
                  )}
                >
                  {done ? (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <Circle className="mt-0.5 size-3.5 shrink-0 text-slate-300" />
                  )}
                  <span className="flex-1 truncate">
                    {t.due_time && <span className="mr-1 text-[10px] tabular-nums text-slate-400">{t.due_time}</span>}
                    {t.title}
                  </span>
                </button>
              );
            })}
          </>
        ) : (
          <>
            {dayGoals.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-slate-400">
                {canCreateGoal ? "Нет целей на день" : "Выберите неделю"}
              </div>
            )}
            {dayGoals.map((g) => (
              <DayGoalRow
                key={g.id}
                goal={g}
                isSelected={selectedDayGoalId === g.id}
                axName={lookupAxis(goalAxes, g.axis)?.name}
                axColor={lookupAxis(goalAxes, g.axis)?.color}
                onClick={() => onSelectDayGoal(selectedDayGoalId === g.id ? null : g.id)}
              />
            ))}

            {selectedDayGoal && linkedRels.length > 0 && (
              <div className="mt-3 border-t border-dashed border-slate-200 pt-2">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-widest text-slate-400">
                  Задачи цели «{selectedDayGoal.title}»
                </div>
                {linkedRels.map((r) => {
                  const it = items.find((i) => i.id === r.target_id);
                  const done = it?.status === "done";
                  return (
                    <button
                      key={r.id}
                      onClick={() => it && openDetail(it.id)}
                      className={cn(
                        "mb-1 flex w-full items-start gap-1.5 rounded border bg-white px-2 py-1.5 text-left text-xs",
                        done ? "border-emerald-100 text-slate-400 line-through" : "border-slate-100 text-slate-800 hover:border-slate-200",
                      )}
                    >
                      {done ? (
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                      ) : (
                        <Circle className="mt-0.5 size-3.5 shrink-0 text-slate-300" />
                      )}
                      <span className="flex-1 truncate">{r.target_title || it?.title || "(удалена)"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {createOpen && parentWeekId && (
        <CreateGoalDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          level="day"
          parentId={parentWeekId}
        />
      )}
    </div>
  );
}

function DayGoalRow({
  goal,
  isSelected,
  axName,
  axColor,
  onClick,
}: {
  goal: GoalFull;
  isSelected: boolean;
  axName?: string;
  axColor?: string;
  onClick: () => void;
}) {
  const pct = Math.round(goal.progress * 100);
  return (
    <button
      onClick={onClick}
      className={cn(
        "mb-1 flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition",
        isSelected
          ? "border-slate-300 bg-white shadow-sm"
          : "border-transparent bg-white/50 hover:border-slate-200 hover:bg-white",
      )}
    >
      <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: axColor ?? "#cbd5e1" }} />
      <div className="min-w-0 flex-1">
        {axName && <div className="text-[9px] font-medium uppercase tracking-wide text-slate-400">{axName}</div>}
        <div className="truncate text-[13px] font-medium text-slate-900">{goal.title}</div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: axColor ?? "#64748b" }} />
          </div>
          <span className="w-8 text-right text-[10px] tabular-nums text-slate-500">{pct}%</span>
        </div>
      </div>
      <ChevronRight className={cn("size-3.5 shrink-0 self-center text-slate-300", isSelected && "text-slate-500")} />
    </button>
  );
}
