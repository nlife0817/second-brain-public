"use client";

import { useEffect, useMemo } from "react";
import { useBrainStore } from "@/lib/store";
import { GOAL_LEVEL_CONFIG, type GoalLevel, type GoalFull } from "@/types";
import { GoalColumn } from "./GoalColumn";
import { GoalDetailPanel } from "./GoalDetailPanel";
import { DayColumn } from "./DayColumn";
import { cn } from "@/lib/utils";
import { ChevronRight, Layers } from "lucide-react";
import type { GoalColumnKey, GoalDeadlineOp, GoalGroupBy } from "@/lib/store";

/** Real goal levels (drive selection cascade and `goal_metrics` parent-chain). */
const LEVEL_ORDER: GoalLevel[] = ["year", "quarter", "month", "week"];
/** All visible columns including the virtual "day" tasks projection. */
const COLUMN_ORDER: GoalColumnKey[] = ["year", "quarter", "month", "week", "day"];

const COLUMN_LABEL: Record<GoalColumnKey, { label: string; short: string }> = {
  year: GOAL_LEVEL_CONFIG.year,
  quarter: GOAL_LEVEL_CONFIG.quarter,
  month: GOAL_LEVEL_CONFIG.month,
  week: GOAL_LEVEL_CONFIG.week,
  day: { label: "Дни", short: "Д" },
};

const TODAY_ISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function startOfWeekISO(today: string): string {
  const d = new Date(today + "T00:00:00");
  const dow = d.getDay(); // 0 = Sunday
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function endOfWeekISO(today: string): string {
  const d = new Date(startOfWeekISO(today) + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DEADLINE_OPS: Array<{ id: GoalDeadlineOp; label: string; needsDate?: boolean }> = [
  { id: "all", label: "Все" },
  { id: "today", label: "Сегодня" },
  { id: "this_week", label: "На этой неделе" },
  { id: "active", label: "Сейчас активна" },
  { id: "overdue", label: "Просрочены" },
  { id: "upcoming", label: "Будущие" },
  { id: "before", label: "До даты", needsDate: true },
  { id: "after", label: "После даты", needsDate: true },
  { id: "is_empty", label: "Без срока" },
  { id: "is_not_empty", label: "Со сроком" },
];

const GROUP_BY_OPTIONS: Array<{ id: GoalGroupBy; label: string }> = [
  { id: "none", label: "Без группировки" },
  { id: "status", label: "По статусу" },
  { id: "priority", label: "По приоритету" },
  { id: "category", label: "По категории" },
  { id: "clients", label: "По клиенту" },
];

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
  const groupBy = useBrainStore((s) => s.goalGroupBy);
  const setGroupBy = useBrainStore((s) => s.setGoalGroupBy);
  const selected = useBrainStore((s) => s.goalSelected);
  const collapsed = useBrainStore((s) => s.goalCollapsedColumns);
  const toggleCollapsed = useBrainStore((s) => s.toggleGoalColumnCollapsed);

  useEffect(() => {
    if (!goalsLoaded) void fetchGoals();
    if (!goalAxesLoaded) void fetchGoalAxes();
  }, [goalsLoaded, fetchGoals, goalAxesLoaded, fetchGoalAxes]);

  const today = useMemo(() => TODAY_ISO(), []);

  const filtered = useMemo(() => {
    const byId = new Map(goals.map((g) => [g.id, g]));
    const isDone = (g: GoalFull): boolean => g.status === "done" || (g.progress ?? 0) >= 0.999;
    const weekStart = startOfWeekISO(today);
    const weekEnd = endOfWeekISO(today);
    const matchesDeadline = (g: GoalFull): boolean => {
      const op = deadlineFilter.op;
      if (op === "all") return true;
      const end = g.period_end;
      const start = g.period_start;
      if (op === "is_empty") return !end;
      if (op === "is_not_empty") return !!end;
      if (!end) return false;
      if (op === "today") return start ? (start <= today && today <= end) : end === today;
      if (op === "this_week") {
        const s = start ?? end;
        return !(end < weekStart || s > weekEnd);
      }
      if (op === "active") return end >= today && (start ?? "") <= today;
      if (op === "overdue") return end < today && !isDone(g);
      if (op === "upcoming") return (start ?? "") > today;
      if (op === "before") return deadlineFilter.value ? end < deadlineFilter.value : true;
      if (op === "after") return deadlineFilter.value ? end > deadlineFilter.value : true;
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

  const collapsedSet = useMemo(() => new Set<GoalColumnKey>(collapsed), [collapsed]);
  const visibleColumns = COLUMN_ORDER.filter((l) => !collapsedSet.has(l));

  const needsDate = deadlineFilter.op === "before" || deadlineFilter.op === "after";

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
          <select
            value={deadlineFilter.op}
            onChange={(e) => setDeadlineFilter({ op: e.target.value as GoalDeadlineOp, value: deadlineFilter.value })}
            className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
          >
            {DEADLINE_OPS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          {needsDate && (
            <input
              type="date"
              value={deadlineFilter.value}
              onChange={(e) => setDeadlineFilter({ op: deadlineFilter.op, value: e.target.value })}
              className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
            />
          )}
          {(deadlineFilter.op !== "all" || deadlineFilter.value) && (
            <button
              type="button"
              onClick={() => setDeadlineFilter({ op: "all", value: "" })}
              className="text-[11px] text-slate-400 hover:text-slate-600"
              title="Сбросить фильтр срока"
            >
              ×
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5" title="Применяется к колонке «Дни»">
          <Layers className="size-3.5 text-slate-400" />
          <span className="text-[11px] font-medium uppercase tracking-widest text-slate-400">Дни:</span>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GoalGroupBy)}
            className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
          >
            {GROUP_BY_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
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
          {COLUMN_ORDER.map((col) => {
            const isCollapsed = collapsedSet.has(col);
            return (
              <button
                key={col}
                onClick={() => toggleCollapsed(col)}
                title={isCollapsed ? `Развернуть «${COLUMN_LABEL[col].label}»` : `Свернуть «${COLUMN_LABEL[col].label}»`}
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase",
                  isCollapsed
                    ? "border-slate-200 bg-white text-slate-400"
                    : "border-slate-900 bg-slate-900 text-white",
                )}
              >
                {COLUMN_LABEL[col].short}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex flex-1 min-w-0 divide-x divide-slate-200 overflow-hidden">
          {COLUMN_ORDER.map((col) => {
            const isCollapsed = collapsedSet.has(col);
            if (isCollapsed) {
              const selectedId = col === "day" ? null : selected[col as GoalLevel];
              const sel = selectedId ? goals.find((g) => g.id === selectedId) : null;
              return (
                <button
                  key={col}
                  onClick={() => toggleCollapsed(col)}
                  className="group flex w-9 shrink-0 flex-col items-center gap-2 border-slate-200 bg-slate-50/40 py-3 text-slate-500 hover:bg-slate-100"
                  title={`Развернуть «${COLUMN_LABEL[col].label}»`}
                >
                  <ChevronRight className="size-3.5 opacity-50 group-hover:opacity-100" />
                  <span
                    className="text-[11px] font-semibold uppercase tracking-widest"
                    style={{ writingMode: "vertical-rl" }}
                  >
                    {COLUMN_LABEL[col].label}
                    {sel && (
                      <span className="ml-2 font-normal text-slate-400"> · {sel.title}</span>
                    )}
                  </span>
                </button>
              );
            }
            const flexBasis = `${100 / visibleColumns.length}%`;
            if (col === "day") {
              return (
                <div key={col} style={{ flex: `1 1 ${flexBasis}`, minWidth: 0 }}>
                  <DayColumn
                    parentWeekId={selected.week ?? null}
                    levelLabel={COLUMN_LABEL.day.label}
                    onCollapse={() => toggleCollapsed("day")}
                  />
                </div>
              );
            }
            const lvl = col as GoalLevel;
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
