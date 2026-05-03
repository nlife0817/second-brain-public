"use client";

import { useState } from "react";
import { useBrainStore } from "@/lib/store";
import { GOAL_AXIS_CONFIG, type GoalLevel, type GoalAxis, type GoalFull } from "@/types";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateGoalDialog } from "./CreateGoalDialog";

interface Props {
  level: GoalLevel;
  goals: GoalFull[];
  parentId: string | null;
  levelLabel: string;
}

export function GoalColumn({ level, goals, parentId, levelLabel }: Props) {
  const selected = useBrainStore((s) => s.goalSelected);
  const selectGoal = useBrainStore((s) => s.selectGoal);
  const axisFilter = useBrainStore((s) => s.goalAxisFilter);
  const [createOpen, setCreateOpen] = useState(false);

  const canCreate = level === "year" || parentId !== null;

  return (
    <div className="flex min-w-0 flex-col bg-slate-50/30">
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
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {goals.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-slate-400">
            {canCreate ? "Пусто" : "Выберите родителя"}
          </div>
        )}
        {goals.map((g) => (
          <GoalRow
            key={g.id}
            goal={g}
            isSelected={selected[level] === g.id}
            onClick={() => selectGoal(level, selected[level] === g.id ? null : g.id)}
          />
        ))}
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

function GoalRow({
  goal,
  isSelected,
  onClick,
}: {
  goal: GoalFull;
  isSelected: boolean;
  onClick: () => void;
}) {
  const ax = goal.axis ? GOAL_AXIS_CONFIG[goal.axis as GoalAxis] : null;
  const pct = Math.round(goal.progress * 100);
  return (
    <button
      onClick={onClick}
      className={cn(
        "group/row mb-1 flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition",
        isSelected
          ? "border-slate-300 bg-white shadow-sm"
          : "border-transparent bg-white/50 hover:border-slate-200 hover:bg-white",
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
              {ax.icon} {ax.label}
            </span>
          )}
          {goal.children_count > 0 && (
            <span className="text-[10px] text-slate-400">↳ {goal.children_count}</span>
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
}
