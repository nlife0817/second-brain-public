"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { ChevronLeft, Repeat, Target as TargetIcon, Lightbulb, Inbox } from "lucide-react";
import {
  DndContext, DragEndEvent, useDroppable, useDraggable,
  PointerSensor, TouchSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import type { Item } from "@/types";
import type {
  PlanningPeriod,
  PlanningSettings,
  PlanningInitiative,
  PlanningMetric,
  PlanningInitiativeMetricLink,
} from "@/types/planning";
import { INITIATIVE_STATUS_LABEL, SEMANTIC_CLASS, initiativeStatusTone } from "@/lib/planning-colors";
import { formatMetricValue } from "@/lib/planning-format";
import { WeekCascadePicker } from "@/components/planning/WeekCascadePicker";
import { isoWeek, parseWeekKey, weekKey, weekStartDate } from "@/lib/iso-week";
import { usePlanningStore } from "@/lib/planning-store";

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

export default function ThisWeekPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const directions = usePlanningStore((s) => s.directions);
  const selectedDirectionId = usePlanningStore((s) => s.selectedDirectionId);
  const setSelectedDirection = usePlanningStore((s) => s.setSelectedDirection);
  const fetchAllStore = usePlanningStore((s) => s.fetchAll);
  const storeLoaded = usePlanningStore((s) => s.loaded);

  const weekParam = searchParams.get("week");
  const directionParam = searchParams.get("direction");

  // Эффективные значения week / direction.
  const effectiveWeek = useMemo(() => {
    if (weekParam && parseWeekKey(weekParam)) return weekParam;
    return currentWeekKey();
  }, [weekParam]);

  // direction: URL > store > null
  const effectiveDirection = directionParam ?? selectedDirectionId ?? null;

  const [data, setData] = useState<ThisWeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Подгружаем стор (нужны directions) — но только если ещё не загружен.
  useEffect(() => {
    if (!storeLoaded) fetchAllStore();
  }, [storeLoaded, fetchAllStore]);

  // Если URL пришёл с direction — синхронизируем стор (чтобы /planning/columns увидел тот же выбор).
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

  // DnD: фикс из P1.4 — sensors с activationConstraint, чтобы скролл не съедал drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const moveTask = async (taskId: string, plannedDate: string | null) => {
    if (!data) return;
    const update: { planned_date: string | null; planned_period_id?: string } = { planned_date: plannedDate };
    if (plannedDate) update.planned_period_id = data.period.id;
    setData({
      ...data,
      items: data.items.map((t) => t.id === taskId
        ? { ...t, planned_date: plannedDate, planned_period_id: plannedDate ? data.period.id : t.planned_period_id }
        : t),
    });
    const res = await fetch(`/api/items/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (!res.ok) { toast.error("Не удалось переместить"); fetchData(effectiveWeek, effectiveDirection); }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const taskId = String(e.active.id);
    const dest = e.over?.id ? String(e.over.id) : null;
    if (!dest) return;
    if (dest === "backlog") moveTask(taskId, null);
    else moveTask(taskId, dest);
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

  const hoursByDate: Record<string, number> = {};
  for (const t of data.items) {
    if (!t.planned_date) continue;
    hoursByDate[t.planned_date] = (hoursByDate[t.planned_date] ?? 0) + (t.estimated_minutes ?? 0) / 60;
  }
  const totalHours = Object.values(hoursByDate).reduce((s, h) => s + h, 0);
  const weeklyCap = Number(data.settings.weekly_capacity_hours ?? 40);

  const carryoverCount = data.items.filter((t) => t.is_carryover && t.status !== "done").length;

  // Дефолт-проверка: вычисляем понедельник недели из выбранного key (для пикера, не из ответа).
  const parsedWeek = parseWeekKey(effectiveWeek);
  const pickerWeekKey = parsedWeek
    ? weekKey(parsedWeek.year, parsedWeek.week)
    : currentWeekKey();
  // start/end label из самой выбранной недели (а не из ответа, чтобы исключить рассинхрон):
  const pickerStart = parsedWeek ? weekStartDate(parsedWeek.year, parsedWeek.week) : new Date(data.period.start_date);
  const pickerEnd = new Date(pickerStart); pickerEnd.setUTCDate(pickerStart.getUTCDate() + 6);
  void pickerEnd;

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
            <span className="text-xs text-slate-500">
              Неделя {data.period.week_n}
            </span>
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
            <span className={`inline-flex items-center gap-1 tabular-nums ${totalHours > weeklyCap ? "text-red-600" : ""}`}>
              <TargetIcon className="size-3" />
              {totalHours.toFixed(1)} / {weeklyCap}ч
            </span>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <aside className="w-[320px] shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3">
            <Section title="Метрики недели" icon={<TargetIcon className="size-3" />}>
              {data.metrics.length === 0 ? (
                <Empty>Нет привязанных метрик</Empty>
              ) : data.metrics.map((m) => {
                const target = data.targets_by_metric[m.id] ?? 0;
                return (
                  <div key={m.id} className="rounded-md border border-slate-200 bg-white p-2 text-xs">
                    <p className="font-medium text-slate-800">{m.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Цель: <span className="font-medium text-slate-700">{formatMetricValue(target, m.unit)}</span>
                    </p>
                  </div>
                );
              })}
            </Section>

            <Section title="Инициативы в работе" icon={<Lightbulb className="size-3" />}>
              {data.initiatives.length === 0 ? (
                <Empty>Активных инициатив нет</Empty>
              ) : data.initiatives.slice(0, 10).map((i) => {
                const tone = initiativeStatusTone(i.status);
                const dot = SEMANTIC_CLASS[tone].dot;
                return (
                  <div key={i.id} className="rounded-md border border-slate-200 bg-white p-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
                      <p className="flex-1 font-medium text-slate-800 line-clamp-1">{i.title}</p>
                    </div>
                    <p className="ml-3 mt-0.5 text-[10px] text-slate-500">{INITIATIVE_STATUS_LABEL[i.status]}</p>
                  </div>
                );
              })}
            </Section>

            <Section title="Бэклог задач" icon={<Inbox className="size-3" />}>
              <BacklogDroppable />
              {data.backlog.length === 0 ? (
                <Empty>Бэклог пуст</Empty>
              ) : (
                <>
                  <p className="mb-1 text-[10px] text-slate-400">
                    Перетащите задачу в день недели →
                  </p>
                  {data.backlog.map((t) => <DraggableTask key={t.id} task={t} />)}
                </>
              )}
            </Section>
          </aside>

          {/* Day grid */}
          <main className="flex-1 overflow-auto p-4">
            {data.items.length === 0 && data.backlog.length === 0 && (
              <div className="mb-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-6 text-center">
                <p className="text-sm text-slate-600">На этой неделе пока нет задач.</p>
                <p className="mt-1 text-xs text-slate-500">
                  Создайте задачу в колонке Задачи или импортируйте из Kaiten.
                </p>
                <Link href="/planning/columns" className="mt-3 inline-block rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700">
                  К колонкам
                </Link>
              </div>
            )}
            <div className={`grid gap-3 ${data.settings.weekend_days_visible ? "grid-cols-7" : "grid-cols-5"}`}>
              {days.map((label, i) => {
                const date = dayDates[i];
                const hours = hoursByDate[date] ?? 0;
                const overload = hours > Number(data.settings.daily_capacity_hours);
                const dayItems = data.items.filter((t) => t.planned_date === date);
                return (
                  <DayColumn
                    key={date}
                    label={label}
                    dateLabel={formatDayDate(date)}
                    date={date}
                    isToday={date === today}
                    hours={hours}
                    overload={overload}
                    tasks={dayItems}
                    dailyCap={Number(data.settings.daily_capacity_hours)}
                  />
                );
              })}
            </div>
          </main>
        </div>
      </div>
    </DndContext>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {icon}
        {title}
      </h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-white px-2 py-1.5 text-xs text-slate-400">{children}</p>;
}

function BacklogDroppable() {
  const { isOver, setNodeRef } = useDroppable({ id: "backlog" });
  return <div ref={setNodeRef} className={`mb-1 h-1.5 rounded transition-colors ${isOver ? "bg-blue-300" : ""}`} />;
}

function DraggableTask({ task }: { task: Item }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id });
  const isDone = task.status === "done";
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        touchAction: "none",
        ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : {}),
      }}
      className={`cursor-grab rounded-md border bg-white p-2 text-xs hover:bg-slate-50 ${
        isDone ? "border-slate-100 opacity-60" : "border-slate-200"
      }`}
    >
      <div className={`font-medium ${isDone ? "line-through" : ""}`}>{task.title}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
        {task.is_carryover && (
          <span className="inline-flex items-center gap-0.5 font-semibold text-amber-600">
            <Repeat className="size-2.5" />перенос
          </span>
        )}
        {task.estimated_minutes ? (
          <span className="tabular-nums">{(task.estimated_minutes / 60).toFixed(1)}ч</span>
        ) : null}
      </div>
    </div>
  );
}

function DayColumn({
  label, dateLabel, date, isToday, hours, overload, tasks, dailyCap,
}: {
  label: string; dateLabel: string; date: string; isToday: boolean;
  hours: number; overload: boolean; tasks: Item[]; dailyCap: number;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: date });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[200px] flex-col rounded-lg border ${
        overload ? "border-red-300 bg-red-50/60" : "border-slate-200 bg-white"
      } ${isOver ? "ring-2 ring-blue-400" : ""} ${isToday ? "ring-1 ring-blue-300" : ""}`}
    >
      <div className="flex items-center justify-between border-b border-inherit px-2 py-1.5">
        <div className="flex items-baseline gap-1.5">
          <span className={`text-xs font-semibold ${isToday ? "text-blue-700" : "text-slate-700"}`}>{label}</span>
          <span className="text-[10px] text-slate-500">{dateLabel}</span>
          {isToday && <span className="rounded bg-blue-100 px-1 text-[9px] font-semibold text-blue-700">сегодня</span>}
        </div>
        <span className={`text-[10px] tabular-nums ${overload ? "font-semibold text-red-600" : "text-slate-500"}`}>
          {hours.toFixed(1)} / {dailyCap}ч
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        {tasks.length === 0 ? (
          <p className="mt-2 text-center text-[10px] text-slate-300">перетащите сюда</p>
        ) : tasks.map((t) => <DraggableTask key={t.id} task={t} />)}
      </div>
    </div>
  );
}
