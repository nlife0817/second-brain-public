"use client";

import { useEffect, useMemo } from "react";
import { useBrainStore } from "@/lib/store";
import { GOAL_LEVEL_CONFIG, type GoalLevel, type GoalFull } from "@/types";
import { GoalColumn } from "./GoalColumn";
import { GoalDetailPanel } from "./GoalDetailPanel";
import { DayColumn } from "./DayColumn";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

const LEVEL_ORDER: GoalLevel[] = ["year", "quarter", "month", "week", "day"];

const TODAY_ISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function GoalsView() {
  const goals = useBrainStore((s) => s.goals);
  const goalsLoaded = useBrainStore((s) => s.goalsLoaded);
  const fetchGoals = useBrainStore((s) => s.fetchGoals);
  const goalAxes = useBrainStore((s) => s.goalAxes);
  const goalAxesLoaded = useBrainStore((s) => s.goalAxesLoaded);
  const fetchGoalAxes = useBrainStore((s) => s.fetchGoalAxes);
  const axisFilter = useBrainStore((s) => s.goalAxisFilter);
  const setAxisFilter = useBrainStore((s) => s.setGoalAxisFilter);
  const hideDone = useBrainStore((s) => s.goalHideDone);
  const setHideDone = useBrainStore((s) => s.setGoalHideDone);
  const deadlineFilter = useBrainStore((s) => s.goalDeadlineFilter);
  const setDeadlineFilter = useBrainStore((s) => s.setGoalDeadlineFilter);
  const selected = useBrainStore((s) => s.goalSelected);
  const collapsed = useBrainStore((s) => s.goalCollapsedColumns);
  const toggleCollapsed = useBrainStore((s) => s.toggleGoalColumnCollapsed);
  const selectGoal = useBrainStore((s) => s.selectGoal);

  useEffect(() => {
    if (!goalsLoaded) void fetchGoals();
    if (!goalAxesLoaded) void fetchGoalAxes();
  }, [goalsLoaded, fetchGoals, goalAxesLoaded, fetchGoalAxes]);

  const today = useMemo(() => TODAY_ISO(), []);

  const filtered = useMemo(() => {
    const byId = new Map(goals.map((g) => [g.id, g]));
    const isDone = (g: GoalFull): boolean => g.status === "done" || (g.progress ?? 0) >= 0.999;
    const matchesDeadline = (g: GoalFull): boolean => {
      if (deadlineFilter === "all") return true;
      const end = g.period_end;
      if (!end) return false;
      if (deadlineFilter === "active") return end >= today && (g.period_start ?? "") <= today;
      if (deadlineFilter === "overdue") return end < today && !isDone(g);
      if (deadlineFilter === "upcoming") return (g.period_start ?? "") > today;
      return true;
    };
    const matchesAxis = (g: GoalFull): boolean => {
      if (!axisFilter) return true;
      if (g.axis === axisFilter) return true;
      let cur: GoalFull | undefined = g;
      while (cur?.parent_id) {
        cur = byId.get(cur.parent_id);
        if (cur?.axis === axisFilter) return true;
      }
      return goals.some((c) => c.parent_id === g.id && c.axis === axisFilter);
    };
    return goals.filter((g) => {
      if (hideDone && isDone(g)) return false;
      if (!matchesDeadline(g)) return false;
      if (!matchesAxis(g)) return false;
      return true;
    });
  }, [goals, axisFilter, hideDone, deadlineFilter, today]);

  const sortByPeriod = useMemo(
    () => (a: GoalFull, b: GoalFull): number => {
      const sa = a.period_start ?? "";
      const sb = b.period_start ?? "";
      if (sa !== sb) return sa < sb ? -1 : 1;
      return (a.position ?? 0) - (b.position ?? 0);
    },
    [],
  );

  const columnGoals = useMemo(() => {
    const byLevel = new Map<GoalLevel, GoalFull[]>();
    for (const lvl of LEVEL_ORDER) byLevel.set(lvl, []);
    byLevel.set("year", filtered.filter((g) => g.level === "year").sort(sortByPeriod));
    for (let i = 1; i < LEVEL_ORDER.length; i++) {
      const lvl = LEVEL_ORDER[i];
      const parentLvl = LEVEL_ORDER[i - 1];
      const parentId = selected[parentLvl];
      const arr = parentId
        ? filtered.filter((g) => g.level === lvl && g.parent_id === parentId)
        : filtered.filter((g) => g.level === lvl);
      byLevel.set(lvl, arr.sort(sortByPeriod));
    }
    return byLevel;
  }, [filtered, selected, sortByPeriod]);

  const deepestSelected = useMemo(() => {
    for (let i = LEVEL_ORDER.length - 1; i >= 0; i--) {
      const id = selected[LEVEL_ORDER[i]];
      if (id) return goals.find((g) => g.id === id) ?? null;
    }
    return null;
  }, [selected, goals]);

  const collapsedSet = useMemo(() => new Set(collapsed), [collapsed]);
  const visibleLevels = LEVEL_ORDER.filter((l) => !collapsedSet.has(l));

  const DEADLINE_TABS: Array<{ id: typeof deadlineFilter; label: string; title: string }> = [
    { id: "all", label: "Все сроки", title: "Все цели независимо от дедлайна" },
    { id: "active", label: "Сейчас", title: "Цели, чей период идёт сейчас" },
    { id: "overdue", label: "Просрочены", title: "Период закончился, цель не достигнута" },
    { id: "upcoming", label: "Будущие", title: "Период ещё не начался" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
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
          {goalAxes.map((ax) => (
            <button
              key={ax.id}
              onClick={() => setAxisFilter(axisFilter === ax.id ? null : ax.id)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition",
                axisFilter === ax.id
                  ? "text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
              )}
              style={
                axisFilter === ax.id
                  ? { backgroundColor: ax.color, borderColor: ax.color }
                  : undefined
              }
            >
              <span className="mr-1">{ax.icon}</span>
              {ax.name}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-widest text-slate-400">Срок:</span>
          {DEADLINE_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setDeadlineFilter(t.id)}
              title={t.title}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition",
                deadlineFilter === t.id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-xs text-slate-700 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={hideDone}
            onChange={(e) => setHideDone(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Скрыть достигнутые
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-medium uppercase tracking-widest text-slate-400">Колонки:</span>
          {LEVEL_ORDER.map((lvl) => {
            const isCollapsed = collapsedSet.has(lvl);
            return (
              <button
                key={lvl}
                onClick={() => toggleCollapsed(lvl)}
                title={isCollapsed ? `Развернуть «${GOAL_LEVEL_CONFIG[lvl].label}»` : `Свернуть «${GOAL_LEVEL_CONFIG[lvl].label}»`}
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase",
                  isCollapsed
                    ? "border-slate-200 bg-white text-slate-400"
                    : "border-slate-900 bg-slate-900 text-white",
                )}
              >
                {GOAL_LEVEL_CONFIG[lvl].short}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex flex-1 min-w-0 divide-x divide-slate-200 overflow-hidden">
          {LEVEL_ORDER.map((lvl) => {
            const isCollapsed = collapsedSet.has(lvl);
            if (isCollapsed) {
              const selectedId = selected[lvl];
              const sel = selectedId ? goals.find((g) => g.id === selectedId) : null;
              return (
                <button
                  key={lvl}
                  onClick={() => toggleCollapsed(lvl)}
                  className="group flex w-9 shrink-0 flex-col items-center gap-2 border-slate-200 bg-slate-50/40 py-3 text-slate-500 hover:bg-slate-100"
                  title={`Развернуть «${GOAL_LEVEL_CONFIG[lvl].label}»`}
                >
                  <ChevronRight className="size-3.5 opacity-50 group-hover:opacity-100" />
                  <span
                    className="text-[11px] font-semibold uppercase tracking-widest"
                    style={{ writingMode: "vertical-rl" }}
                  >
                    {GOAL_LEVEL_CONFIG[lvl].label}
                    {sel && (
                      <span className="ml-2 font-normal text-slate-400"> · {sel.title}</span>
                    )}
                  </span>
                </button>
              );
            }
            const flexBasis = `${100 / visibleLevels.length}%`;
            if (lvl === "day") {
              return (
                <div key={lvl} style={{ flex: `1 1 ${flexBasis}`, minWidth: 0 }}>
                  <DayColumn
                    parentWeekId={selected.week ?? null}
                    selectedDayGoalId={selected.day ?? null}
                    onSelectDayGoal={(id) => selectGoal("day", id)}
                    levelLabel={GOAL_LEVEL_CONFIG.day.label}
                    onCollapse={() => toggleCollapsed("day")}
                    dayGoals={columnGoals.get("day") ?? []}
                  />
                </div>
              );
            }
            return (
              <div key={lvl} style={{ flex: `1 1 ${flexBasis}`, minWidth: 0 }}>
                <GoalColumn
                  level={lvl}
                  goals={columnGoals.get(lvl) ?? []}
                  parentId={
                    lvl === "year"
                      ? null
                      : selected[LEVEL_ORDER[LEVEL_ORDER.indexOf(lvl) - 1]] ?? null
                  }
                  levelLabel={GOAL_LEVEL_CONFIG[lvl].label}
                  onCollapse={() => toggleCollapsed(lvl)}
                  today={today}
                />
              </div>
            );
          })}
        </div>
        <GoalDetailPanel goal={deepestSelected} />
      </div>
    </div>
  );
}
