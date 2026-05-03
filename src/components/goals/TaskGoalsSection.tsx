"use client";

import { useEffect, useState, useCallback } from "react";
import { useBrainStore } from "@/lib/store";
import {
  GOAL_AXIS_CONFIG, GOAL_LEVEL_CONFIG,
  type GoalFull, type RelationWithTarget, type GoalAxis,
} from "@/types";
import { Target, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TaskGoalsSection({ taskId }: { taskId: string }) {
  const goals = useBrainStore((s) => s.goals);
  const goalsLoaded = useBrainStore((s) => s.goalsLoaded);
  const fetchGoals = useBrainStore((s) => s.fetchGoals);
  const fetchRelations = useBrainStore((s) => s.fetchRelations);
  const linkTaskToGoal = useBrainStore((s) => s.linkTaskToGoal);
  const unlinkTaskFromGoal = useBrainStore((s) => s.unlinkTaskFromGoal);
  const setAppSection = useBrainStore((s) => s.setAppSection);
  const selectGoal = useBrainStore((s) => s.selectGoal);

  const [linked, setLinked] = useState<RelationWithTarget[]>([]);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    const rels = await fetchRelations("item", taskId);
    setLinked(
      rels.filter((r) => {
        // Other side of the relation is a goal
        const otherType = r.source_type === "item" ? r.target_type : r.source_type;
        return otherType === "goal" && r.relation_type?.id === "belongs_to_goal";
      }),
    );
  }, [fetchRelations, taskId]);

  useEffect(() => {
    if (!goalsLoaded) void fetchGoals();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [taskId, goalsLoaded, fetchGoals, refresh]);

  const linkedIds = new Set(
    linked.map((r) => (r.source_type === "goal" ? r.source_id : r.target_id)),
  );
  const candidates: GoalFull[] = !search.trim()
    ? []
    : goals
        .filter((g) => !linkedIds.has(g.id))
        .filter((g) => g.title.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 6);

  function openInGoals(goal: GoalFull) {
    // Navigate up the chain so all selectGoal calls land on the right ancestors.
    const chain: GoalFull[] = [];
    let cur: GoalFull | undefined = goal;
    const byId = new Map(goals.map((g) => [g.id, g]));
    while (cur) {
      chain.unshift(cur);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    setAppSection("goals");
    for (const g of chain) selectGoal(g.level, g.id);
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Target className="size-3.5 text-slate-500" />
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Цели
        </h3>
        <span className="text-[10px] tabular-nums text-slate-400">{linked.length}</span>
      </div>

      <div className="space-y-1">
        {linked.map((r) => {
          const goalId = r.source_type === "goal" ? r.source_id : r.target_id;
          const g = goals.find((x) => x.id === goalId);
          const ax = g?.axis ? GOAL_AXIS_CONFIG[g.axis as GoalAxis] : null;
          return (
            <div
              key={r.id}
              className="flex items-center gap-1.5 rounded border border-slate-100 bg-slate-50/50 px-2 py-1.5"
            >
              {ax && (
                <span
                  className="rounded px-1 py-0.5 text-[9px] font-medium uppercase"
                  style={{ backgroundColor: ax.bg, color: ax.color }}
                >
                  {ax.icon}
                </span>
              )}
              {g && (
                <span className="rounded border border-slate-200 px-1 py-0.5 text-[9px] uppercase text-slate-500">
                  {GOAL_LEVEL_CONFIG[g.level].short}
                </span>
              )}
              <button
                onClick={() => g && openInGoals(g)}
                className="flex-1 truncate text-left text-xs text-slate-700 hover:underline"
                title="Открыть в разделе «Цели»"
              >
                {r.target_title || g?.title || "(удалена)"}
              </button>
              <button
                onClick={async () => {
                  await unlinkTaskFromGoal(goalId, taskId);
                  await refresh();
                }}
                className="text-slate-300 hover:text-red-500"
                title="Отвязать"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
        {!linked.length && (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-center text-[11px] text-slate-400">
            Задача не привязана к целям.
          </p>
        )}
      </div>

      {!adding ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 h-7 w-full justify-center text-xs"
          onClick={() => setAdding(true)}
        >
          <Plus className="mr-1 size-3" /> Привязать к цели
        </Button>
      ) : (
        <div className="mt-2 rounded-md border border-slate-200 bg-white p-1.5">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Найти цель…"
            className="h-7 text-xs"
            autoFocus
          />
          <div className="mt-1 max-h-40 overflow-y-auto">
            {candidates.map((c) => {
              const ax = c.axis ? GOAL_AXIS_CONFIG[c.axis as GoalAxis] : null;
              return (
                <button
                  key={c.id}
                  onClick={async () => {
                    await linkTaskToGoal(c.id, taskId);
                    await refresh();
                    setSearch("");
                    setAdding(false);
                  }}
                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-slate-100"
                >
                  {ax && (
                    <span
                      className="rounded px-1 py-0.5 text-[9px]"
                      style={{ backgroundColor: ax.bg, color: ax.color }}
                    >
                      {ax.icon}
                    </span>
                  )}
                  <span className={cn("rounded border border-slate-200 px-1 py-0.5 text-[9px] uppercase text-slate-500")}>
                    {GOAL_LEVEL_CONFIG[c.level].short}
                  </span>
                  <span className="flex-1 truncate">{c.title}</span>
                </button>
              );
            })}
            {search && !candidates.length && (
              <p className="px-1.5 py-1 text-[11px] text-slate-400">Ничего не найдено</p>
            )}
          </div>
          <div className="mt-1 flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px]"
              onClick={() => {
                setAdding(false);
                setSearch("");
              }}
            >
              Закрыть
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
