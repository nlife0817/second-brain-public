"use client";

import { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import {
  ChevronLeft, Repeat, Target as TargetIcon, Inbox, History,
  ArrowDownAZ, ArrowDownUp, Layers, Maximize2,
} from "lucide-react";
import { TaskDetailModal } from "@/components/task/TaskDetailSheet";
import { useBrainStore } from "@/lib/store";
import {
  DndContext, DragEndEvent, useDroppable, useDraggable,
  PointerSensor, TouchSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import type { Item, DevelopmentParticipant } from "@/types";
import type {
  PlanningPeriod,
  PlanningSettings,
  PlanningInitiative,
  PlanningMetric,
  PlanningInitiativeMetricLink,
  EffectiveCapacity,
  ReplanReason,
} from "@/types/planning";
import { ReplanReasonDialog } from "@/components/planning/ReplanReasonDialog";
import { WeekCascadePicker } from "@/components/planning/WeekCascadePicker";
import { ParticipantAvatar } from "@/components/planning/ParticipantAvatar";
import { MetricSidebar } from "@/components/planning/MetricSidebar";
import { isoWeek, parseWeekKey, weekKey, weekStartDate } from "@/lib/iso-week";
import { usePlanningStore } from "@/lib/planning-store";
import { markLocalMutation } from "@/lib/planning-realtime";

interface MetricActual {
  ticks: Array<{ id: string; value: number; measured_at: string; source: string | null }>;
  aggregated: number | null;
}

interface ThisWeekData {
  period: PlanningPeriod;
  settings: PlanningSettings;
  items: Item[];
  backlog: Item[];
  metrics: PlanningMetric[];
  targets_by_metric: Record<string, number>;
  initiatives: PlanningInitiative[];
  initiative_metric_links: PlanningInitiativeMetricLink[];
  direction_id: string | null;
  participants: DevelopmentParticipant[];
  effective_capacities: EffectiveCapacity[];
  metric_actuals_for_week: Record<string, MetricActual>;
}

const DAY_LABELS_5 = ["Пн", "Вт", "Ср", "Чт", "Пт"];
const DAY_LABELS_7 = [...DAY_LABELS_5, "Сб", "Вс"];
const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function formatDayDate(date: string): string {
  const d = new Date(date);
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()] ?? ""}`;
}

function currentWeekKey(): string {
  const w = isoWeek(new Date());
  return weekKey(w.year, w.week);
}

function parseDropTarget(id: string): { backlog: boolean; participantId?: string; date?: string } {
  if (id === "backlog") return { backlog: true };
  const pipe = id.indexOf("|");
  if (pipe < 0) return { backlog: false };
  return { backlog: false, participantId: id.slice(0, pipe), date: id.slice(pipe + 1) };
}

function dropId(participantId: string, date: string): string {
  return `${participantId}|${date}`;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// --- Backlog filter / sort / group (P5) ---
type SortMode = "priority" | "created" | "estimate" | "updated" | "deadline";
type GroupMode = "none" | "category" | "initiative" | "assignee" | "priority" | "deadline";
type DeadlineBucket = "any" | "overdue" | "this_week" | "next_week" | "later" | "none";

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 5, high: 4, medium: 3, low: 2, none: 1,
};

interface BacklogControls {
  q: string;
  category: string;            // "" = all
  initiativeId: string;        // "" = all
  assigneeId: string;          // "" = all
  priority: string;            // "" = all
  hasEstimate: "any" | "yes" | "no";
  deadline: DeadlineBucket;
  sort: SortMode;
  group: GroupMode;
}

const DEFAULT_CONTROLS: BacklogControls = {
  q: "", category: "", initiativeId: "", assigneeId: "", priority: "",
  hasEstimate: "any", deadline: "any", sort: "priority", group: "none",
};

// effective дедлайн задачи: planned_end_date перекрывает due_date (см. F3).
function taskDeadline(t: Item): string | null {
  return t.planned_end_date ?? t.due_date ?? null;
}

function deadlineBucket(t: Item, weekStart: string, weekEnd: string, nextWeekEnd: string, today: string): DeadlineBucket {
  const d = taskDeadline(t);
  if (!d) return "none";
  if (d < today) return "overdue";
  if (d >= weekStart && d <= weekEnd) return "this_week";
  if (d > weekEnd && d <= nextWeekEnd) return "next_week";
  return "later";
}

const DEADLINE_LABEL: Record<DeadlineBucket, string> = {
  any: "любой",
  overdue: "Просрочено",
  this_week: "Эта неделя",
  next_week: "Следующая",
  later: "Позже",
  none: "Без дедлайна",
};

const STORAGE_BACKLOG = "planning:this-week:backlogControls";

function loadControls(): BacklogControls {
  if (typeof window === "undefined") return DEFAULT_CONTROLS;
  try {
    const raw = window.localStorage.getItem(STORAGE_BACKLOG);
    if (!raw) return DEFAULT_CONTROLS;
    return { ...DEFAULT_CONTROLS, ...(JSON.parse(raw) as Partial<BacklogControls>) };
  } catch { return DEFAULT_CONTROLS; }
}

function saveControls(c: BacklogControls): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_BACKLOG, JSON.stringify(c)); } catch { /* ignore */ }
}

export default function ThisWeekPage() {
  return (
    <Suspense fallback={null}>
      <ThisWeekPageInner />
    </Suspense>
  );
}

function ThisWeekPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const directions = usePlanningStore((s) => s.directions);
  const selectedDirectionId = usePlanningStore((s) => s.selectedDirectionId);
  const setSelectedDirection = usePlanningStore((s) => s.setSelectedDirection);
  const fetchAllStore = usePlanningStore((s) => s.fetchAll);
  const storeLoaded = usePlanningStore((s) => s.loaded);
  const openTaskDetail = useBrainStore((s) => s.openDetail);
  const brainFetchInit = useBrainStore((s) => s.fetchInit);
  const brainLoaded = useBrainStore((s) => s.items.length > 0);

  const weekParam = searchParams.get("week");
  const directionParam = searchParams.get("direction");

  const effectiveWeek = useMemo(() => {
    if (weekParam && parseWeekKey(weekParam)) return weekParam;
    return currentWeekKey();
  }, [weekParam]);

  const effectiveDirection = directionParam ?? selectedDirectionId ?? null;

  const [data, setData] = useState<ThisWeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [controls, setControls] = useState<BacklogControls>(DEFAULT_CONTROLS);
  const [pendingMove, setPendingMove] = useState<null | { taskId: string; planned_date: string; assignee_participant_id?: string }>(null);
  const [historyForTask, setHistoryForTask] = useState<string | null>(null);

  useEffect(() => { setControls(loadControls()); }, []);

  useEffect(() => {
    if (!storeLoaded) fetchAllStore();
  }, [storeLoaded, fetchAllStore]);

  useEffect(() => {
    if (!brainLoaded) brainFetchInit();
  }, [brainLoaded, brainFetchInit]);

  useEffect(() => {
    if (directionParam && directionParam !== selectedDirectionId) {
      setSelectedDirection(directionParam);
    }
  }, [directionParam, selectedDirectionId, setSelectedDirection]);

  const fetchData = useCallback(async (week: string, dir: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("week", week);
      if (dir) params.set("direction_id", dir);
      const res = await fetch(`/api/planning/this-week?${params.toString()}`);
      if (!res.ok) {
        setError("Не удалось загрузить данные недели");
        return;
      }
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(effectiveWeek, effectiveDirection);
  }, [fetchData, effectiveWeek, effectiveDirection]);

  const updateUrl = useCallback((next: { week?: string; direction?: string | null }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.week !== undefined) params.set("week", next.week);
    if (next.direction !== undefined) {
      if (next.direction === null) params.delete("direction");
      else params.set("direction", next.direction);
    }
    router.replace(`/planning/this-week?${params.toString()}`);
  }, [router, searchParams]);

  const onWeekChange = (key: string) => updateUrl({ week: key });
  const onDirectionChange = (id: string | null) => {
    setSelectedDirection(id);
    updateUrl({ direction: id });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // P6: при drop сохраняется длительность задачи (end - start). Если задача
  // была в бэклоге и нет диапазона — start = end = newDate.
  const performMove = useCallback(async (
    taskId: string,
    payload: { planned_date: string | null; assignee_participant_id?: string; replan?: ReplanReason | null },
  ) => {
    if (!data) return;
    const task = data.items.find((t) => t.id === taskId) ?? data.backlog.find((t) => t.id === taskId);
    if (!task) return;

    let newStart: string | null = payload.planned_date;
    let newEnd: string | null = payload.planned_date;
    if (payload.planned_date && task.planned_start_date && task.planned_end_date) {
      const span = Math.max(0, daysBetween(task.planned_start_date, task.planned_end_date));
      newEnd = addDays(payload.planned_date, span);
    }

    const update: {
      planned_date: string | null;
      planned_period_id?: string | null;
      planned_start_date?: string | null;
      planned_end_date?: string | null;
      assignee_participant_id?: string;
      replan_reason_code?: string;
      replan_reason_text?: string;
    } = {
      planned_date: newStart,
      planned_start_date: newStart,
      planned_end_date: newEnd,
    };
    if (payload.planned_date) update.planned_period_id = data.period.id;
    else update.planned_period_id = null;
    if (payload.assignee_participant_id) update.assignee_participant_id = payload.assignee_participant_id;
    if (payload.replan?.code) {
      update.replan_reason_code = payload.replan.code;
      if (payload.replan.text) update.replan_reason_text = payload.replan.text;
    }

    // Optimistic
    setData((prev) => {
      if (!prev) return prev;
      const fromBacklog = prev.backlog.find((t) => t.id === taskId);
      const fromItems = prev.items.find((t) => t.id === taskId);
      const target = fromItems ?? fromBacklog;
      if (!target) return prev;
      const merged: Item = {
        ...target,
        planned_date: newStart,
        planned_start_date: newStart,
        planned_end_date: newEnd,
        planned_period_id: newStart ? prev.period.id : null,
        ...(payload.assignee_participant_id ? { assignee_participant_id: payload.assignee_participant_id } : {}),
      };
      if (newStart === null) {
        return {
          ...prev,
          items: prev.items.filter((t) => t.id !== taskId),
          backlog: fromBacklog ? prev.backlog : [merged, ...prev.backlog],
        };
      }
      return {
        ...prev,
        items: fromItems
          ? prev.items.map((t) => (t.id === taskId ? merged : t))
          : [...prev.items, merged],
        backlog: prev.backlog.filter((t) => t.id !== taskId),
      };
    });

    markLocalMutation();
    const res = await fetch(`/api/items/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      toast.error("Не удалось переместить");
      fetchData(effectiveWeek, effectiveDirection);
    }
  }, [data, fetchData, effectiveWeek, effectiveDirection]);

  // P7: если задача УЖЕ была запланирована (planned_start_date был не null) —
  // открываем диалог причины перед сохранением.
  const onDragEnd = (e: DragEndEvent) => {
    const taskId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId || !data) return;
    const t = parseDropTarget(overId);
    const task = data.items.find((x) => x.id === taskId) ?? data.backlog.find((x) => x.id === taskId);
    const wasPlanned = !!task?.planned_start_date;

    if (t.backlog) {
      if (wasPlanned) {
        setPendingMove({ taskId, planned_date: "" }); // "" сигналит бэклог-возврат
      } else {
        performMove(taskId, { planned_date: null });
      }
      return;
    }
    if (t.date && t.participantId) {
      // Если ничего не меняется — игнорируем
      if (
        task && task.planned_start_date === t.date
        && (task.assignee_participant_id ?? null) === t.participantId
      ) return;
      if (wasPlanned) {
        setPendingMove({ taskId, planned_date: t.date, assignee_participant_id: t.participantId });
      } else {
        performMove(taskId, { planned_date: t.date, assignee_participant_id: t.participantId });
      }
    }
  };

  if (loading && !data) return <div className="p-6 text-sm text-slate-500">Загрузка…</div>;
  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-slate-600">{error ?? "Нет данных"}</p>
        <button onClick={() => fetchData(effectiveWeek, effectiveDirection)} className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700">
          Попробовать ещё раз
        </button>
      </div>
    );
  }

  const days = data.settings.weekend_days_visible ? DAY_LABELS_7 : DAY_LABELS_5;
  const weekStart = new Date(data.period.start_date);
  const dayDates: string[] = days.map((_, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(weekStart.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const today = new Date().toISOString().slice(0, 10);

  const participantById = new Map(data.participants.map((p) => [p.id, p]));
  const effCapById = new Map(data.effective_capacities.map((c) => [c.participant_id, c]));
  const initiativeById = new Map(data.initiatives.map((i) => [i.id, i]));

  // Pre-group items by participant once вместо filter() × P секций × рендеров.
  // Также pre-build dateToIdx — ParticipantRow раньше пересобирал его на каждый рендер каждой строки.
  const itemsByPid = new Map<string, Item[]>();
  const dateToIdx = new Map(dayDates.map((d, i) => [d, i]));
  for (const it of data.items) {
    if (!it.assignee_participant_id) continue;
    let arr = itemsByPid.get(it.assignee_participant_id);
    if (!arr) { arr = []; itemsByPid.set(it.assignee_participant_id, arr); }
    arr.push(it);
  }
  const getItemsFor = (pid: string): Item[] => itemsByPid.get(pid) ?? [];

  const owner = data.participants.find((p) => p.role === "owner") ?? null;
  const devsWithTasks = new Set<string>();
  const othersWithTasks = new Set<string>();
  for (const [pid] of itemsByPid) {
    const role = participantById.get(pid)?.role;
    if (role === "developer") devsWithTasks.add(pid);
    else if (role === "other") othersWithTasks.add(pid);
  }
  const developers = data.participants
    .filter((p) => p.role === "developer" && (p.is_active || devsWithTasks.has(p.id)))
    .sort((a, b) => a.position - b.position);
  const others = data.participants
    .filter((p) => p.role === "other" && othersWithTasks.has(p.id))
    .sort((a, b) => a.position - b.position);

  // P6 equal-split hours per day для overload-сводки.
  const hoursByPidDate: Record<string, Record<string, number>> = {};
  for (const t of data.items) {
    if (!t.assignee_participant_id) continue;
    const pid = t.assignee_participant_id;
    const start = t.planned_start_date ?? t.planned_date;
    const end = t.planned_end_date ?? start;
    if (!start || !end) continue;
    const span = Math.max(0, daysBetween(start, end)) + 1;
    const perDay = (t.estimated_minutes ?? 0) / 60 / span;
    for (let i = 0; i < span; i++) {
      const date = addDays(start, i);
      hoursByPidDate[pid] ??= {};
      hoursByPidDate[pid][date] = (hoursByPidDate[pid][date] ?? 0) + perDay;
    }
  }
  const totalHoursOf = (pid: string) =>
    Object.values(hoursByPidDate[pid] ?? {}).reduce((s, h) => s + h, 0);
  const devCap = developers.reduce((s, p) => s + (effCapById.get(p.id)?.hours ?? 0), 0);
  const devUsed = developers.reduce((s, p) => s + totalHoursOf(p.id), 0);
  const totalHoursWeek = data.items.reduce((s, t) => s + (t.estimated_minutes ?? 0) / 60, 0);
  const weeklyCap = Number(data.settings.weekly_capacity_hours ?? 40);
  const carryoverCount = data.items.filter((t) => t.is_carryover && t.status !== "done").length;

  const parsedWeek = parseWeekKey(effectiveWeek);
  const pickerWeekKey = parsedWeek ? weekKey(parsedWeek.year, parsedWeek.week) : currentWeekKey();
  const pickerStart = parsedWeek ? weekStartDate(parsedWeek.year, parsedWeek.week) : new Date(data.period.start_date);
  void pickerStart;

  // P5: бэклог фильтр / сорт / групп.
  const updateControls = (patch: Partial<BacklogControls>) => {
    setControls((prev) => {
      const next = { ...prev, ...patch };
      saveControls(next);
      return next;
    });
  };

  // F5: расчёт буферов дедлайна — текущая неделя из data.period; следующая
  // неделя — +7 дней. today сравниваем по YYYY-MM-DD.
  const weekStartStr = data.period.start_date;
  const weekEndStr = data.period.end_date;
  const nextWeekEndStr = addDays(weekEndStr, 7);

  let backlogFiltered = data.backlog;
  if (controls.q.trim()) {
    const q = controls.q.toLowerCase();
    backlogFiltered = backlogFiltered.filter((t) =>
      t.title.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q),
    );
  }
  if (controls.category) backlogFiltered = backlogFiltered.filter((t) => t.category === controls.category);
  if (controls.assigneeId) backlogFiltered = backlogFiltered.filter((t) => t.assignee_participant_id === controls.assigneeId);
  if (controls.priority) backlogFiltered = backlogFiltered.filter((t) => t.priority === controls.priority);
  if (controls.hasEstimate === "yes") backlogFiltered = backlogFiltered.filter((t) => (t.estimated_minutes ?? 0) > 0);
  if (controls.hasEstimate === "no") backlogFiltered = backlogFiltered.filter((t) => !t.estimated_minutes);
  if (controls.deadline !== "any") {
    backlogFiltered = backlogFiltered.filter(
      (t) => deadlineBucket(t, weekStartStr, weekEndStr, nextWeekEndStr, today) === controls.deadline,
    );
  }

  backlogFiltered = [...backlogFiltered].sort((a, b) => {
    switch (controls.sort) {
      case "priority":
        return (PRIORITY_ORDER[b.priority] ?? 0) - (PRIORITY_ORDER[a.priority] ?? 0)
          || (b.created_at < a.created_at ? -1 : 1);
      case "created":
        return b.created_at.localeCompare(a.created_at);
      case "updated":
        return b.updated_at.localeCompare(a.updated_at);
      case "estimate":
        return (b.estimated_minutes ?? 0) - (a.estimated_minutes ?? 0);
      case "deadline": {
        const ad = taskDeadline(a) ?? "9999-12-31";
        const bd = taskDeadline(b) ?? "9999-12-31";
        return ad.localeCompare(bd);
      }
    }
  });

  // Группировка для отображения (без useMemo — Rules of Hooks: код после early-return).
  const DEADLINE_GROUP_ORDER: DeadlineBucket[] = ["overdue", "this_week", "next_week", "later", "none"];
  let groupedBacklog: Array<{ key: string; title: string; items: Item[] }>;
  if (controls.group === "none") {
    groupedBacklog = [{ key: "_", title: "", items: backlogFiltered }];
  } else {
    const map = new Map<string, { title: string; items: Item[] }>();
    for (const t of backlogFiltered) {
      let key = "_";
      let title = "Без группы";
      if (controls.group === "category") {
        key = t.category; title = t.category;
      } else if (controls.group === "assignee") {
        key = t.assignee_participant_id ?? "_";
        title = participantById.get(key)?.name ?? "Не назначено";
      } else if (controls.group === "priority") {
        key = t.priority; title = t.priority;
      } else if (controls.group === "deadline") {
        const b = deadlineBucket(t, weekStartStr, weekEndStr, nextWeekEndStr, today);
        key = b; title = DEADLINE_LABEL[b];
      } else if (controls.group === "initiative") {
        key = "_"; title = "Бэклог";
      }
      const g = map.get(key) ?? { title, items: [] as Item[] };
      g.items.push(t);
      map.set(key, g);
    }
    let arr = Array.from(map.entries()).map(([key, g]) => ({ key, title: g.title, items: g.items }));
    if (controls.group === "deadline") {
      const orderIdx = (k: string) =>
        DEADLINE_GROUP_ORDER.indexOf(k as DeadlineBucket);
      arr = arr.sort((a, b) => orderIdx(a.key) - orderIdx(b.key));
    } else if (controls.group === "priority") {
      arr = arr.sort((a, b) =>
        (PRIORITY_ORDER[b.key] ?? 0) - (PRIORITY_ORDER[a.key] ?? 0),
      );
    }
    groupedBacklog = arr;
  }

  const pendingTask = pendingMove && data.items.find((t) => t.id === pendingMove.taskId);

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex h-[calc(100vh-3rem)] flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2">
          <div className="flex items-center gap-3">
            <Link href="/planning/columns" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              <ChevronLeft className="size-3.5" />
              Колонки
            </Link>
            <WeekCascadePicker value={pickerWeekKey} onChange={onWeekChange} />
            <span className="text-xs text-slate-500">Неделя {data.period.week_n}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <select
              value={effectiveDirection ?? ""}
              onChange={(e) => onDirectionChange(e.target.value || null)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              title="Фильтр по направлению"
            >
              <option value="">Все направления</option>
              {directions.map((d) => (
                <option key={d.id} value={d.id}>{d.title}</option>
              ))}
            </select>
            {carryoverCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-amber-700">
                <Repeat className="size-3" />
                Перенесено {carryoverCount}
              </span>
            )}
            <span className={`inline-flex items-center gap-1 tabular-nums ${totalHoursWeek > weeklyCap ? "text-red-600" : ""}`}>
              <TargetIcon className="size-3" />
              {totalHoursWeek.toFixed(1)} / {weeklyCap}ч
            </span>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar — бэклог + фильтр */}
          <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <Inbox className="size-3" />
                Бэклог
              </h3>
              <span className="text-[11px] tabular-nums text-slate-500">{backlogFiltered.length}/{data.backlog.length}</span>
            </div>

            {/* Filter controls */}
            <div className="grid grid-cols-2 gap-1 border-b border-slate-200 bg-white p-2 text-[11px]">
              <input
                value={controls.q}
                onChange={(e) => updateControls({ q: e.target.value })}
                placeholder="Поиск…"
                className="col-span-2 rounded border border-slate-200 px-2 py-1 text-xs"
              />
              <select
                value={controls.category}
                onChange={(e) => updateControls({ category: e.target.value })}
                className="rounded border border-slate-200 px-1 py-0.5 text-[11px]"
              >
                <option value="">Все категории</option>
                <option value="development">development</option>
                <option value="management">management</option>
                <option value="meeting">meeting</option>
                <option value="other">other</option>
              </select>
              <select
                value={controls.assigneeId}
                onChange={(e) => updateControls({ assigneeId: e.target.value })}
                className="rounded border border-slate-200 px-1 py-0.5 text-[11px]"
              >
                <option value="">Любой исполнитель</option>
                {data.participants.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select
                value={controls.hasEstimate}
                onChange={(e) => updateControls({ hasEstimate: e.target.value as BacklogControls["hasEstimate"] })}
                className="rounded border border-slate-200 px-1 py-0.5 text-[11px]"
              >
                <option value="any">любые часы</option>
                <option value="yes">с оценкой</option>
                <option value="no">без оценки</option>
              </select>
              <select
                value={controls.priority}
                onChange={(e) => updateControls({ priority: e.target.value })}
                className="rounded border border-slate-200 px-1 py-0.5 text-[11px]"
              >
                <option value="">любой приоритет</option>
                <option value="urgent">срочно</option>
                <option value="high">высокий</option>
                <option value="medium">средний</option>
                <option value="low">низкий</option>
                <option value="none">без</option>
              </select>
              <select
                value={controls.deadline}
                onChange={(e) => updateControls({ deadline: e.target.value as DeadlineBucket })}
                className="rounded border border-slate-200 px-1 py-0.5 text-[11px]"
              >
                <option value="any">любой дедлайн</option>
                <option value="overdue">просрочено</option>
                <option value="this_week">эта неделя</option>
                <option value="next_week">следующая</option>
                <option value="later">позже</option>
                <option value="none">без дедлайна</option>
              </select>
              <label className="inline-flex items-center gap-1 rounded border border-slate-200 px-1 py-0.5 text-[11px]">
                <ArrowDownUp className="size-3 text-slate-500" />
                <select
                  value={controls.sort}
                  onChange={(e) => updateControls({ sort: e.target.value as SortMode })}
                  className="bg-transparent text-[11px] outline-none"
                >
                  <option value="priority">приоритет</option>
                  <option value="created">создание</option>
                  <option value="updated">обновление</option>
                  <option value="estimate">оценка</option>
                  <option value="deadline">дедлайн</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-1 rounded border border-slate-200 px-1 py-0.5 text-[11px]">
                <Layers className="size-3 text-slate-500" />
                <select
                  value={controls.group}
                  onChange={(e) => updateControls({ group: e.target.value as GroupMode })}
                  className="bg-transparent text-[11px] outline-none"
                >
                  <option value="none">без групп</option>
                  <option value="category">категория</option>
                  <option value="assignee">исполнитель</option>
                  <option value="priority">приоритет</option>
                  <option value="deadline">дедлайн</option>
                  <option value="initiative">инициатива</option>
                </select>
              </label>
              <button
                onClick={() => updateControls(DEFAULT_CONTROLS)}
                className="col-span-2 rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50"
              >
                сбросить фильтры
              </button>
            </div>

            <BacklogDroppable />
            <div className="flex-1 overflow-y-auto p-2">
              {backlogFiltered.length === 0 ? (
                <p className="rounded-md bg-white px-2 py-1.5 text-xs text-slate-400">
                  {data.backlog.length === 0 ? "Бэклог пуст" : "По фильтру ничего"}
                </p>
              ) : (
                groupedBacklog.map((g) => (
                  <div key={g.key} className="mb-2">
                    {g.title && (
                      <h4 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        <ArrowDownAZ className="size-3" />
                        {g.title}
                        <span className="text-slate-400">·{g.items.length}</span>
                      </h4>
                    )}
                    <div className="flex flex-col gap-1">
                      {g.items.map((t) => (
                        <DraggableTask
                          key={t.id}
                          task={t}
                          participant={t.assignee_participant_id ? participantById.get(t.assignee_participant_id) : undefined}
                          onShowHistory={() => setHistoryForTask(t.id)}
                          onOpen={() => openTaskDetail(t.id)}
                          compact
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          {/* Day grid — две секции */}
          <main className="flex flex-1 flex-col overflow-auto p-3">
            <DayHeader days={days} dayDates={dayDates} today={today} dailyCap={Number(data.settings.daily_capacity_hours)} />

            {owner && (
              <SectionBlock
                title="Моя"
                used={totalHoursOf(owner.id)}
                cap={effCapById.get(owner.id)?.hours ?? 0}
              >
                <ParticipantRow
                  participant={owner}
                  days={days}
                  dayDates={dayDates}
                  today={today}
                  items={getItemsFor(owner.id)}
                  dailyCap={Number(data.settings.daily_capacity_hours)}
                  participantById={participantById}
                  showAvatar={false}
                  onShowHistory={setHistoryForTask}
                  onOpenTask={openTaskDetail}
                  hoursByDate={hoursByPidDate[owner.id] ?? {}}
                  dateToIdx={dateToIdx}
                />
              </SectionBlock>
            )}

            <SectionBlock title="Разработка" used={devUsed} cap={devCap}>
              {developers.length === 0 ? (
                <p className="rounded-md bg-slate-50 px-2 py-2 text-xs text-slate-400">Нет активных разработчиков.</p>
              ) : developers.map((p) => (
                <ParticipantRow
                  key={p.id}
                  participant={p}
                  days={days}
                  dayDates={dayDates}
                  today={today}
                  items={getItemsFor(p.id)}
                  dailyCap={Number(data.settings.daily_capacity_hours)}
                  effectiveCapHours={effCapById.get(p.id)?.hours ?? 0}
                  participantById={participantById}
                  showAvatar
                  onShowHistory={setHistoryForTask}
                  onOpenTask={openTaskDetail}
                  hoursByDate={hoursByPidDate[p.id] ?? {}}
                  dateToIdx={dateToIdx}
                />
              ))}
            </SectionBlock>

            {others.length > 0 && (
              <SectionBlock title="Прочее" muted>
                {others.map((p) => (
                  <ParticipantRow
                    key={p.id}
                    participant={p}
                    days={days}
                    dayDates={dayDates}
                    today={today}
                    items={getItemsFor(p.id)}
                    dailyCap={Number(data.settings.daily_capacity_hours)}
                    effectiveCapHours={effCapById.get(p.id)?.hours ?? 0}
                    participantById={participantById}
                    showAvatar
                    onShowHistory={setHistoryForTask}
                    onOpenTask={openTaskDetail}
                    hoursByDate={hoursByPidDate[p.id] ?? {}}
                    dateToIdx={dateToIdx}
                  />
                ))}
              </SectionBlock>
            )}
          </main>

          {/* Right sidebar — metrics (P4) */}
          <MetricSidebar
            period={data.period}
            directionId={data.direction_id}
            metrics={data.metrics}
            initiatives={data.initiatives}
            initiativeMetricLinks={data.initiative_metric_links}
            targetsByMetric={data.targets_by_metric}
            metricActuals={data.metric_actuals_for_week}
            onActualSaved={() => fetchData(effectiveWeek, effectiveDirection)}
          />
        </div>
      </div>

      {/* P7: Replan reason dialog */}
      <ReplanReasonDialog
        open={!!pendingMove}
        onClose={() => {
          setPendingMove(null);
          // отмена — откатываем состояние
          fetchData(effectiveWeek, effectiveDirection);
        }}
        onConfirm={async (reason) => {
          if (!pendingMove) return;
          await performMove(pendingMove.taskId, {
            planned_date: pendingMove.planned_date === "" ? null : pendingMove.planned_date,
            assignee_participant_id: pendingMove.assignee_participant_id,
            replan: reason,
          });
          setPendingMove(null);
        }}
        title={`Перенос задачи «${pendingTask?.title ?? ""}»`}
      />

      {/* P7: history popover-as-modal */}
      <PlanHistoryModal
        itemId={historyForTask}
        onClose={() => setHistoryForTask(null)}
        participantById={participantById}
        initiativeById={initiativeById}
      />

      {/* Полная карточка задачи: открывается по иконке Maximize2 */}
      <TaskDetailModal forceModal />
    </DndContext>
  );
}

function BacklogDroppable() {
  const { isOver, setNodeRef } = useDroppable({ id: "backlog" });
  return <div ref={setNodeRef} className={`h-1.5 transition-colors ${isOver ? "bg-blue-300" : "bg-transparent"}`} />;
}

function DayHeader({
  days, dayDates, today, dailyCap,
}: { days: string[]; dayDates: string[]; today: string; dailyCap: number }) {
  return (
    <div className="sticky top-0 z-10 mb-2 grid grid-cols-[140px_1fr] gap-2 bg-white/95 backdrop-blur">
      <div />
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))` }}
      >
        {days.map((label, i) => {
          const date = dayDates[i];
          const isToday = date === today;
          return (
            <div key={date} className={`flex items-baseline justify-between rounded px-2 py-1 text-[11px] ${isToday ? "bg-blue-50 text-blue-700" : "text-slate-500"}`}>
              <span className="font-semibold">{label}</span>
              <span>{formatDayDate(date)}</span>
              <span className="text-[10px] text-slate-400">{dailyCap}ч</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionBlock({
  title, used, cap, muted, children,
}: {
  title: string;
  used?: number;
  cap?: number;
  muted?: boolean;
  children: React.ReactNode;
}) {
  const overload = used !== undefined && cap !== undefined && cap > 0 && used > cap;
  return (
    <div className={`mb-3 rounded-lg border ${muted ? "border-slate-100" : "border-slate-200"} ${muted ? "bg-slate-50/40" : "bg-white"}`}>
      <div className="flex items-center justify-between border-b border-inherit px-3 py-1.5">
        <h3 className={`text-xs font-semibold ${muted ? "text-slate-500" : "text-slate-700"}`}>{title}</h3>
        {used !== undefined && cap !== undefined && (
          <span className={`text-[11px] tabular-nums ${overload ? "font-semibold text-red-600" : "text-slate-500"}`}>
            {used.toFixed(1)} / {cap.toFixed(0)}ч
          </span>
        )}
      </div>
      <div className="p-2">{children}</div>
    </div>
  );
}

function ParticipantRow({
  participant, days, dayDates, today, items, dailyCap, effectiveCapHours, participantById,
  showAvatar, onShowHistory, onOpenTask, hoursByDate, dateToIdx,
}: {
  participant: DevelopmentParticipant;
  days: string[];
  dayDates: string[];
  today: string;
  items: Item[];
  dailyCap: number;
  effectiveCapHours?: number;
  participantById: Map<string, DevelopmentParticipant>;
  showAvatar: boolean;
  onShowHistory: (id: string) => void;
  onOpenTask: (id: string) => void;
  hoursByDate: Record<string, number>;
  dateToIdx: Map<string, number>;
}) {
  const total = items.reduce((s, t) => s + (t.estimated_minutes ?? 0) / 60, 0);
  const inactive = participant.is_active === false;

  type Placed = { id: string; colStart: number; colEnd: number; task: Item };
  const placed: Placed[] = [];
  for (const t of items) {
    const start = t.planned_start_date ?? t.planned_date;
    const end = t.planned_end_date ?? start;
    if (!start || !end) continue;
    const sIdxRaw = dateToIdx.get(start);
    const eIdxRaw = dateToIdx.get(end);
    if (sIdxRaw === undefined && eIdxRaw === undefined) continue;
    const sIdx = sIdxRaw ?? 0;
    const eIdx = eIdxRaw ?? dayDates.length - 1;
    const colStart = Math.max(0, sIdx) + 1;
    const colEnd = Math.min(dayDates.length - 1, eIdx) + 2;
    placed.push({ id: t.id, colStart, colEnd, task: t });
  }

  return (
    <div className="mb-2 grid grid-cols-[140px_1fr] gap-2 items-start">
      <div className="flex flex-col gap-0.5 px-2 py-1">
        <div className="flex items-center gap-1.5">
          {showAvatar && <ParticipantAvatar participant={participant} size="sm" />}
          <span className={`text-xs font-medium ${inactive ? "text-slate-400" : "text-slate-700"}`}>
            {participant.name}
          </span>
        </div>
        <span className="text-[10px] tabular-nums text-slate-500">
          {total.toFixed(1)}{effectiveCapHours !== undefined ? ` / ${effectiveCapHours.toFixed(0)}ч` : "ч"}
        </span>
        {inactive && <span className="text-[10px] text-amber-600">inactive</span>}
      </div>
      {/*
       * Высоту строки задают задачи (DOM-поток grid'а), а фон-ячейки дней
       * растягиваются `absolute inset-0` под этим потоком. Так строка
       * расширяется под количество задач, ничего не «уезжает» вниз.
       */}
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-0 grid gap-1"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))` }}
        >
          {dayDates.map((date) => (
            <DayCell
              key={date}
              participantId={participant.id}
              date={date}
              isToday={date === today}
              hours={hoursByDate[date] ?? 0}
              dailyCap={dailyCap}
            />
          ))}
        </div>
        <div
          className="relative grid gap-1 p-1"
          style={{
            gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))`,
            gridAutoRows: "min-content",
            minHeight: 90,
          }}
        >
          {placed.map((p) => (
            <div
              key={p.id}
              className="min-w-0"
              style={{ gridColumnStart: p.colStart, gridColumnEnd: p.colEnd }}
            >
              <DraggableTask
                task={p.task}
                participant={participantById.get(participant.id)}
                onShowHistory={() => onShowHistory(p.id)}
                onOpen={() => onOpenTask(p.task.id)}
                spanDays={p.colEnd - p.colStart}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DayCell({
  participantId, date, isToday, hours, dailyCap,
}: {
  participantId: string;
  date: string;
  isToday: boolean;
  hours: number;
  dailyCap: number;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: dropId(participantId, date) });
  const overload = hours > dailyCap;
  return (
    <div
      ref={setNodeRef}
      className={`pointer-events-auto rounded-md border ${
        overload ? "border-red-300 bg-red-50/50" : "border-slate-200 bg-white"
      } ${isOver ? "ring-2 ring-blue-400" : ""} ${isToday ? "ring-1 ring-blue-200" : ""}`}
    >
      {hours > 0 && (
        <div className={`flex justify-end border-b border-inherit px-1.5 py-0.5 text-[9px] tabular-nums ${overload ? "font-semibold text-red-600" : "text-slate-400"}`}>
          {hours.toFixed(1)}ч
        </div>
      )}
    </div>
  );
}

function DraggableTask({
  task, participant, onShowHistory, onOpen, spanDays, compact,
}: {
  task: Item;
  participant: DevelopmentParticipant | undefined;
  onShowHistory: () => void;
  onOpen: () => void;
  spanDays?: number;
  compact?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id });
  const isDone = task.status === "done";
  const movedAtLeastOnce =
    !!task.original_planned_start_date
    && !!task.planned_start_date
    && task.original_planned_start_date !== task.planned_start_date;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        touchAction: "none",
        ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : {}),
      }}
      className={`group cursor-grab rounded-md border bg-white p-1.5 text-[11px] hover:bg-slate-50 ${
        isDone ? "border-slate-100 opacity-60" : "border-slate-200"
      } ${spanDays && spanDays > 1 ? "border-blue-300 bg-blue-50/30" : ""}`}
      title={spanDays && spanDays > 1 ? `Длится ${spanDays} дн.` : undefined}
    >
      <div className="flex items-start gap-1">
        <ParticipantAvatar participant={participant} size="xs" />
        <div className={`flex-1 font-medium leading-tight ${isDone ? "line-through" : ""}`}>{task.title}</div>
        {movedAtLeastOnce && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onShowHistory(); }}
            className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 text-[9px] text-amber-700 hover:bg-amber-100"
            title="История переносов"
          >
            <History className="size-2.5" />
          </button>
        )}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="rounded p-0.5 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100"
          title="Открыть"
        >
          <Maximize2 className="size-2.5" />
        </button>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
        {task.is_carryover && (
          <span className="inline-flex items-center gap-0.5 font-semibold text-amber-600">
            <Repeat className="size-2.5" />перенос
          </span>
        )}
        {task.estimated_minutes ? (
          <span className="tabular-nums">{(task.estimated_minutes / 60).toFixed(1)}ч</span>
        ) : null}
        {!compact && spanDays && spanDays > 1 && (
          <span className="tabular-nums text-blue-600">{spanDays} дн.</span>
        )}
      </div>
    </div>
  );
}

function PlanHistoryModal({
  itemId, onClose, participantById, initiativeById,
}: {
  itemId: string | null;
  onClose: () => void;
  participantById: Map<string, DevelopmentParticipant>;
  initiativeById: Map<string, PlanningInitiative>;
}) {
  void initiativeById;
  const [rows, setRows] = useState<Array<{
    id: string; changed_at: string; changed_by: string | null;
    planned_start_before: string | null; planned_end_before: string | null;
    planned_start_after: string | null; planned_end_after: string | null;
    assignee_before: string | null; assignee_after: string | null;
    reason_code: string | null; reason_text: string | null;
  }>>([]);

  useEffect(() => {
    if (!itemId) return;
    let active = true;
    fetch(`/api/items/${itemId}/plan-history`).then(async (r) => {
      if (!r.ok || !active) return;
      setRows(await r.json());
    });
    return () => { active = false; };
  }, [itemId]);

  if (!itemId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="max-h-[80vh] w-[480px] overflow-auto rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">История переносов</h3>
          <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-700">Закрыть</button>
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-slate-500">Переносов нет.</p>
        ) : (
          <ol className="space-y-2">
            {rows.map((r) => {
              const fromAss = r.assignee_before ? participantById.get(r.assignee_before)?.name ?? r.assignee_before : "—";
              const toAss = r.assignee_after ? participantById.get(r.assignee_after)?.name ?? r.assignee_after : "—";
              return (
                <li key={r.id} className="rounded border border-slate-100 p-2 text-[11px]">
                  <div className="mb-1 flex items-center justify-between text-slate-500">
                    <span>{new Date(r.changed_at).toLocaleString("ru-RU")}</span>
                    {r.changed_by && <span>{r.changed_by}</span>}
                  </div>
                  <div className="text-slate-700">
                    {r.planned_start_before} – {r.planned_end_before} → <strong>{r.planned_start_after} – {r.planned_end_after}</strong>
                  </div>
                  {fromAss !== toAss && (
                    <div className="text-slate-700">{fromAss} → <strong>{toAss}</strong></div>
                  )}
                  {r.reason_code && (
                    <div className="mt-1 text-amber-700">
                      <span className="font-medium">{r.reason_code}</span>
                      {r.reason_text && <span>: {r.reason_text}</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
