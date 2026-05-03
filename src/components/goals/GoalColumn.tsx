"use client";

import { memo, useState } from "react";
import { useBrainStore } from "@/lib/store";
import type { GoalLevel, GoalFull, GoalAxisConfig } from "@/types";
import { ChevronRight, ChevronsLeft, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateGoalDialog } from "./CreateGoalDialog";
import { lookupAxis } from "@/lib/goal-axes";

interface Props {
  level: GoalLevel;
  goals: GoalFull[];
  parentId: string | null;
  levelLabel: string;
  onCollapse?: () => void;
  /** today's date in YYYY-MM-DD; used to mark past columns/rows compact */
  today?: string;
}

export function GoalColumn({ level, goals, parentId, levelLabel, onCollapse, today }: Props) {
  const selectedMap = useBrainStore((s) => s.goalSelected);
  const selectedId = selectedMap[level] ?? null;
  const selectGoal = useBrainStore((s) => s.selectGoal);
  const axisFilter = useBrainStore((s) => s.goalAxisFilter);
  const goalAxes = useBrainStore((s) => s.goalAxes);
  const [createOpen, setCreateOpen] = useState(false);

  const canCreate = level === "year" || parentId !== null;

  return (
    <div className="flex h-full min-w-0 flex-col bg-slate-50/30">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          {levelLabel}
        </span>
        <span className="text-[11px] tabular-nums text-slate-400">{goals.length}</span>
        <button
          onClick={() => setCreateOpen(true)}
          disabled={!canCreate}
          title={canCreate ? `Создать ${levelLabel.toLowerCase()}` : "Сначала выберите родителя"}
          className={cn(
            "ml-auto flex size-6 items-center justify-center rounded-md text-slate-500 transition",
            canCreate
              ? "hover:bg-slate-100 hover:text-slate-900"
              : "cursor-not-allowed opacity-30",
          )}
        >
          <Plus className="size-3.5" />
        </button>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Свернуть колонку"
            className="flex size-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <ChevronsLeft className="size-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {goals.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-slate-400">
            {canCreate ? "Пусто" : "Выберите родителя"}
          </div>
        )}
        {goals.map((g) => {
          const isPast = !!(today && g.period_end && g.period_end < today);
          const ax = lookupAxis(goalAxes, g.axis);
          return (
            <GoalRow
              key={g.id}
              goal={g}
              ax={ax}
              isSelected={selectedId === g.id}
              isPast={isPast}
              onClick={() => selectGoal(level, selectedId === g.id ? null : g.id)}
            />
          );
        })}
      </div>

      {createOpen && (
        <CreateGoalDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          level={level}
          parentId={parentId}
          defaultAxis={axisFilter}
        />
      )}
    </div>
  );
}

interface RowProps {
  goal: GoalFull;
  ax: GoalAxisConfig | null;
  isSelected: boolean;
  isPast: boolean;
  onClick: () => void;
}

const GoalRow = memo(function GoalRow({ goal, ax, isSelected, isPast, onClick }: RowProps) {
  const pct = Math.round((goal.progress ?? 0) * 100);

  if (isPast && !isSelected) {
    return (
      <button
        onClick={onClick}
        title={`${goal.title} · ${pct}% · период завершён`}
        className={cn(
          "group/row mb-0.5 flex w-full items-center gap-2 rounded-md border border-transparent bg-white/40 px-2 py-1 text-left transition",
          "opacity-60 hover:opacity-100 hover:border-slate-200 hover:bg-white",
        )}
      >
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: ax?.color ?? "#cbd5e1" }}
        />
        <span className="flex-1 truncate text-[11px] text-slate-500">{goal.title}</span>
        <span className="w-7 text-right text-[10px] tabular-nums text-slate-400">{pct}%</span>
        <ChevronRight className="size-3 shrink-0 text-slate-300" />
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "group/row mb-1 flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition",
        isSelected
          ? "border-slate-300 bg-white shadow-sm"
          : "border-transparent bg-white/50 hover:border-slate-200 hover:bg-white",
        isPast && "opacity-80",
      )}
    >
      <span
        className="mt-1 size-2 shrink-0 rounded-full"
        style={{ backgroundColor: ax?.color ?? "#cbd5e1" }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {ax && (
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide"
              style={{ backgroundColor: ax.bg, color: ax.color }}
            >
              {ax.icon} {ax.name}
            </span>
          )}
          {goal.children_count > 0 && (
            <span className="text-[10px] text-slate-400">↳ {goal.children_count}</span>
          )}
          {isPast && (
            <span className="text-[9px] uppercase tracking-wide text-slate-400">завершён</span>
          )}
        </div>
        <div className="mt-1 truncate text-[13px] font-medium text-slate-900">{goal.title}</div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, backgroundColor: ax?.color ?? "#64748b" }}
            />
          </div>
          <span className="w-8 text-right text-[10px] tabular-nums text-slate-500">{pct}%</span>
        </div>
      </div>
      <ChevronRight
        className={cn(
          "size-3.5 shrink-0 self-center text-slate-300 transition",
          isSelected && "text-slate-500",
        )}
      />
    </button>
  );
});
