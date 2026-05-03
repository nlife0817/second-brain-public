"use client";

import { useEffect, useMemo, useState } from "react";
import { useBrainStore, type GoalGroupBy } from "@/lib/store";
import {
  type GoalFull,
  type ItemWithSubtasks,
  type RelationWithTarget,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  type ItemPriority,
  type ItemStatus,
} from "@/types";
import {
  ChevronRight,
  ChevronDown,
  ChevronsLeft,
  Plus,
  CheckCircle2,
  Circle,
  ListChecks,
  Target,
  Briefcase,
} from "lucide-react";
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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function enumerateDays(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const s = new Date(startISO + "T00:00:00");
  const e = new Date(endISO + "T00:00:00");
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(isoFromDate(d));
  return out;
}

const DOW_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

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
  const updateItem = useBrainStore((s) => s.updateItem);
  const itemLinkedClients = useBrainStore((s) => s.itemLinkedClients);
  const categories = useBrainStore((s) => s.categories);
  const groupBy = useBrainStore((s) => s.goalGroupBy);
  const collapsedGroups = useBrainStore((s) => s.goalCollapsedGroups);
  const toggleGroup = useBrainStore((s) => s.toggleGoalGroupCollapsed);

  const [mode, setMode] = useState<Mode>("tasks");
  const [createOpen, setCreateOpen] = useState(false);

  // ---- Days available in this column ----
  const parentWeek = parentWeekId ? goals.find((g) => g.id === parentWeekId) ?? null : null;
  const weekDays: string[] = useMemo(() => {
    if (parentWeek?.period_start && parentWeek?.period_end) {
      return enumerateDays(parentWeek.period_start, parentWeek.period_end);
    }
    return [];
  }, [parentWeek?.period_start, parentWeek?.period_end]);

  // Pick the active day: today if it's in the week, else first day; without a week — today.
  const today = todayLocalISO();
  const fallbackDay = weekDays.length > 0
    ? (weekDays.includes(today) ? today : weekDays[0])
    : today;
  const [date, setDate] = useState<string>(fallbackDay);

  // Re-sync `date` if parent week changes underneath us (different days available now).
  useEffect(() => {
    if (weekDays.length === 0) return;
    if (!weekDays.includes(date)) setDate(weekDays.includes(today) ? today : weekDays[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentWeekId]);

  const canCreateGoal = parentWeekId !== null;

  const selectedDayGoal = selectedDayGoalId ? goals.find((g) => g.id === selectedDayGoalId) ?? null : null;

  // ---- Tasks for the selected day ----
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

  // ---- Group tasks (only tasks mode honors group-by from top bar) ----
  const groupedTasks = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, { key: string; label: string; items: ItemWithSubtasks[] }>();
    for (const t of tasksForDate) {
      let key: string;
      let label: string;
      if (groupBy === "status") {
        key = t.status;
        label = STATUS_CONFIG[t.status as ItemStatus]?.label ?? t.status;
      } else if (groupBy === "priority") {
        key = t.priority;
        label = PRIORITY_CONFIG[t.priority as ItemPriority]?.label ?? t.priority;
      } else if (groupBy === "category") {
        key = t.category ?? "__none__";
        label = categories.find((c) => c.id === key)?.name ?? (key === "__none__" ? "Без категории" : key);
      } else {
        const cs = itemLinkedClients[t.id] ?? [];
        key = cs.length ? cs.slice().sort((a, b) => a.localeCompare(b, "ru")).join(", ") : "__none__";
        label = cs.length ? key : "Без клиента";
      }
      const existing = map.get(key);
      if (existing) existing.items.push(t);
      else map.set(key, { key, label, items: [t] });
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.key === "__none__") return 1;
      if (b.key === "__none__") return -1;
      return a.label.localeCompare(b.label, "ru");
    });
  }, [tasksForDate, groupBy, categories, itemLinkedClients]);

  const collapsedGroupSet = useMemo(() => new Set(collapsedGroups), [collapsedGroups]);

  // ---- Goal-linked tasks (when a day-goal is selected) ----
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
        <div className="border-b border-slate-100 bg-white px-2 py-1.5">
          {weekDays.length > 0 ? (
            <div className="flex gap-0.5">
              {weekDays.map((d) => {
                const dt = new Date(d + "T00:00:00");
                const isToday = d === today;
                const isActive = d === date;
                return (
                  <button
                    key={d}
                    onClick={() => setDate(d)}
                    className={cn(
                      "flex flex-1 flex-col items-center rounded px-1 py-1 text-[10px] transition",
                      isActive
                        ? "bg-slate-900 text-white"
                        : isToday
                          ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                          : "text-slate-500 hover:bg-slate-100",
                    )}
                    title={d}
                  >
                    <span className="font-medium uppercase">{DOW_SHORT[dt.getDay()]}</span>
                    <span className="tabular-nums">{dt.getDate()}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayLocalISO())}
              className="h-7 w-full rounded border border-slate-200 px-2 text-xs text-slate-700"
            />
          )}
          {weekDays.length > 0 && (
            <p className="mt-1 text-center text-[10px] text-slate-400">
              Только дни выбранной недели
            </p>
          )}
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
            {groupedTasks ? (
              groupedTasks.map((grp) => {
                const groupKey = `day:${groupBy}:${grp.key}`;
                const isCollapsed = collapsedGroupSet.has(groupKey);
                return (
                  <div key={grp.key} className="mb-2">
                    <button
                      type="button"
                      onClick={() => toggleGroup(groupKey)}
                      className="mb-1 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px] font-semibold uppercase tracking-widest text-slate-500 hover:bg-slate-100"
                    >
                      {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                      <span className="flex-1 truncate">{grp.label}</span>
                      <span className="tabular-nums text-slate-400">{grp.items.length}</span>
                    </button>
                    {!isCollapsed && grp.items.map((t) => (
                      <DayTaskRow
                        key={t.id}
                        item={t}
                        clients={itemLinkedClients[t.id] ?? []}
                        onOpen={() => openDetail(t.id)}
                        onToggle={() =>
                          void updateItem(t.id, { status: t.status === "done" ? "in_progress" : "done" })
                        }
                      />
                    ))}
                  </div>
                );
              })
            ) : (
              tasksForDate.map((t) => (
                <DayTaskRow
                  key={t.id}
                  item={t}
                  clients={itemLinkedClients[t.id] ?? []}
                  onOpen={() => openDetail(t.id)}
                  onToggle={() =>
                    void updateItem(t.id, { status: t.status === "done" ? "in_progress" : "done" })
                  }
                />
              ))
            )}
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

function DayTaskRow({
  item,
  clients,
  onOpen,
  onToggle,
}: {
  item: ItemWithSubtasks;
  clients: string[];
  onOpen: () => void;
  onToggle: () => void;
}) {
  const done = item.status === "done";
  return (
    <div
      className={cn(
        "mb-1 flex w-full items-start gap-1.5 rounded border bg-white px-2 py-1.5 text-xs transition",
        done ? "border-emerald-100 text-slate-400" : "border-slate-100 text-slate-800 hover:border-slate-200",
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="mt-0.5 shrink-0 rounded-full p-0.5 hover:bg-slate-100"
        title={done ? "Снять отметку «выполнено»" : "Отметить выполненной"}
      >
        {done ? (
          <CheckCircle2 className="size-3.5 text-emerald-500" />
        ) : (
          <Circle className="size-3.5 text-slate-300" />
        )}
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 text-left"
      >
        <div className={cn("flex items-center gap-1", done && "line-through")}>
          {item.due_time && (
            <span className="text-[10px] tabular-nums text-slate-400">{item.due_time}</span>
          )}
          <span className="truncate">{item.title}</span>
        </div>
        {clients.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {clients.slice(0, 3).map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-medium text-slate-600"
                title={`Клиент: ${c}`}
              >
                <Briefcase className="size-2.5" />
                {c}
              </span>
            ))}
            {clients.length > 3 && (
              <span className="text-[9px] text-slate-400">+{clients.length - 3}</span>
            )}
          </div>
        )}
      </button>
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

// Suppress GoalGroupBy import unused-var lint when no grouping uses it.
export type { GoalGroupBy };
