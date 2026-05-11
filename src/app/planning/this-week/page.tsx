"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { ChevronLeft, Repeat, Target as TargetIcon, Lightbulb, Inbox } from "lucide-react";
import {
  DndContext, DragEndEvent, useDroppable, useDraggable,
} from "@dnd-kit/core";
import type { Item } from "@/types";
import type { PlanningPeriod, PlanningSettings, PlanningInitiative, PlanningMetric } from "@/types/planning";
import { INITIATIVE_STATUS_LABEL, SEMANTIC_CLASS, initiativeStatusTone } from "@/lib/planning-colors";
import { formatMetricValue } from "@/lib/planning-format";

interface ThisWeekData {
  period: PlanningPeriod;
  settings: PlanningSettings;
  items: Item[];
  backlog: Item[];
  metrics: PlanningMetric[];
  targets_by_metric: Record<string, number>;
  initiatives: PlanningInitiative[];
}

const DAY_LABELS_5 = ["Пн", "Вт", "Ср", "Чт", "Пт"];
const DAY_LABELS_7 = [...DAY_LABELS_5, "Сб", "Вс"];
const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function formatDayDate(date: string): string {
  const d = new Date(date);
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()] ?? ""}`;
}

export default function ThisWeekPage() {
  const [data, setData] = useState<ThisWeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/planning/this-week");
      if (!res.ok) {
        setError("Не удалось загрузить данные недели");
        return;
      }
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const moveTask = async (taskId: string, plannedDate: string | null) => {
    if (!data) return;
    const update: { planned_date: string | null; planned_period_id?: string } = { planned_date: plannedDate };
    if (plannedDate) update.planned_period_id = data.period.id;
    // optimistic
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
    if (!res.ok) { toast.error("Не удалось переместить"); fetchAll(); }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const taskId = String(e.active.id);
    const dest = e.over?.id ? String(e.over.id) : null;
    if (!dest) return;
    if (dest === "backlog") moveTask(taskId, null);
    else moveTask(taskId, dest);
  };

  if (loading) return <div className="p-6 text-sm text-slate-500">Загрузка…</div>;
  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-slate-600">{error ?? "Нет данных"}</p>
        <button onClick={fetchAll} className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700">
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

  // Aggregate hours by day
  const hoursByDate: Record<string, number> = {};
  for (const t of data.items) {
    if (!t.planned_date) continue;
    hoursByDate[t.planned_date] = (hoursByDate[t.planned_date] ?? 0) + (t.estimated_minutes ?? 0) / 60;
  }
  const totalHours = Object.values(hoursByDate).reduce((s, h) => s + h, 0);
  const weeklyCap = Number(data.settings.weekly_capacity_hours ?? 40);

  // Carryover count: задачи помеченные is_carryover (перенесены автоматически)
  const carryoverCount = data.items.filter((t) => t.is_carryover && t.status !== "done").length;

  const weekStartLabel = `${weekStart.getUTCDate()} ${MONTH_SHORT[weekStart.getUTCMonth()] ?? ""}`;
  const weekEnd = new Date(data.period.end_date);
  const weekEndLabel = `${weekEnd.getUTCDate()} ${MONTH_SHORT[weekEnd.getUTCMonth()] ?? ""}`;

  return (
    <DndContext onDragEnd={onDragEnd}>
      <div className="flex h-[calc(100vh-3rem)] flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <div className="flex items-center gap-3">
            <Link href="/planning/columns" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              <ChevronLeft className="size-3.5" />
              Колонки
            </Link>
            <h1 className="text-base font-semibold">
              Неделя {data.period.week_n} · {weekStartLabel} – {weekEndLabel}
            </h1>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
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
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
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
