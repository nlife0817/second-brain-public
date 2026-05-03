"use client";

import { useEffect, useMemo } from "react";
import { useBrainStore } from "@/lib/store";
import { GOAL_AXIS_CONFIG, GOAL_LEVEL_CONFIG, type GoalAxis, type GoalLevel, type GoalFull } from "@/types";
import { GoalColumn } from "./GoalColumn";
import { GoalDetailPanel } from "./GoalDetailPanel";
import { cn } from "@/lib/utils";

const LEVEL_ORDER: GoalLevel[] = ["year", "quarter", "month", "week"];

export function GoalsView() {
  const goals = useBrainStore((s) => s.goals);
  const goalsLoaded = useBrainStore((s) => s.goalsLoaded);
  const fetchGoals = useBrainStore((s) => s.fetchGoals);
  const axisFilter = useBrainStore((s) => s.goalAxisFilter);
  const setAxisFilter = useBrainStore((s) => s.setGoalAxisFilter);
  const selected = useBrainStore((s) => s.goalSelected);

  useEffect(() => {
    if (!goalsLoaded) void fetchGoals();
  }, [goalsLoaded, fetchGoals]);

  const filtered = useMemo(() => {
    if (!axisFilter) return goals;
    // Show goal if its axis matches OR any ancestor/descendant matches.
    const byId = new Map(goals.map((g) => [g.id, g]));
    function matches(g: GoalFull): boolean {
      if (g.axis === axisFilter) return true;
      let cur: GoalFull | undefined = g;
      while (cur?.parent_id) {
        cur = byId.get(cur.parent_id);
        if (cur?.axis === axisFilter) return true;
      }
      return goals.some((c) => c.parent_id === g.id && matches(c));
    }
    return goals.filter(matches);
  }, [goals, axisFilter]);

  const columnGoals = useMemo(() => {
    const byLevel = new Map<GoalLevel, GoalFull[]>();
    for (const lvl of LEVEL_ORDER) byLevel.set(lvl, []);

    // year column = roots (parent_id null) of level=year
    byLevel.set("year", filtered.filter((g) => g.level === "year"));

    // quarter column shows children of selected year (or all quarters when no year selected)
    for (let i = 1; i < LEVEL_ORDER.length; i++) {
      const lvl = LEVEL_ORDER[i];
      const parentLvl = LEVEL_ORDER[i - 1];
      const parentId = selected[parentLvl];
      if (parentId) {
        byLevel.set(lvl, filtered.filter((g) => g.level === lvl && g.parent_id === parentId));
      } else {
        byLevel.set(lvl, filtered.filter((g) => g.level === lvl));
      }
    }
    return byLevel;
  }, [filtered, selected]);

  const deepestSelected = useMemo(() => {
    for (let i = LEVEL_ORDER.length - 1; i >= 0; i--) {
      const id = selected[LEVEL_ORDER[i]];
      if (id) return goals.find((g) => g.id === id) ?? null;
    }
    return null;
  }, [selected, goals]);

  return (
    <div className="flex h-full flex-col">
      {/* Top bar: title + axis filter */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-slate-900">Цели</span>
        </div>
        <div className="ml-4 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-widest text-slate-400">Ось:</span>
          <button
            onClick={() => setAxisFilter(null)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs font-medium transition",
              !axisFilter
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
            )}
          >
            Все
          </button>
          {(Object.entries(GOAL_AXIS_CONFIG) as [GoalAxis, typeof GOAL_AXIS_CONFIG.income][]).map(([key, ax]) => (
            <button
              key={key}
              onClick={() => setAxisFilter(axisFilter === key ? null : key)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition",
                axisFilter === key
                  ? "text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
              )}
              style={
                axisFilter === key
                  ? { backgroundColor: ax.color, borderColor: ax.color }
                  : undefined
              }
            >
              <span className="mr-1">{ax.icon}</span>
              {ax.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="grid flex-1 min-w-0 grid-cols-4 divide-x divide-slate-200 overflow-hidden">
          {LEVEL_ORDER.map((lvl) => (
            <GoalColumn
              key={lvl}
              level={lvl}
              goals={columnGoals.get(lvl) ?? []}
              parentId={
                lvl === "year"
                  ? null
                  : selected[LEVEL_ORDER[LEVEL_ORDER.indexOf(lvl) - 1]] ?? null
              }
              levelLabel={GOAL_LEVEL_CONFIG[lvl].label}
            />
          ))}
        </div>
        <GoalDetailPanel goal={deepestSelected} />
      </div>
    </div>
  );
}
