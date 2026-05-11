"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  DndContext, DragEndEvent, useDroppable, useDraggable,
} from "@dnd-kit/core";
import type { Item } from "@/types";
import type { PlanningPeriod, PlanningSettings, PlanningInitiative, PlanningMetric } from "@/types/planning";

interface ThisWeekData {
  period: PlanningPeriod;
  settings: PlanningSettings;
  items: Item[];
  backlog: Item[];
  metrics: PlanningMetric[];
  targets_by_metric: Record<string, number>;
  initiatives: PlanningInitiative[];
}

const DAYS_5 = ["Пн", "Вт", "Ср", "Чт", "Пт"];
const DAYS_7 = [...DAYS_5, "Сб", "Вс"];

export default function ThisWeekPage() {
  const [data, setData] = useState<ThisWeekData | null>(null);

  const fetchAll = useCallback(async () => {
    const res = await fetch("/api/planning/this-week");
    if (!res.ok) { toast.error("Не удалось загрузить неделю"); return; }
    setData(await res.json());
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const moveTask = async (taskId: string, plannedDate: string | null) => {
    if (!data) return;
    const update: { planned_date: string | null; planned_period_id?: string } = { planned_date: plannedDate };
    if (plannedDate) update.planned_period_id = data.period.id;
    // optimistic
    const before = data.items.find((t) => t.id === taskId) ?? data.backlog.find((t) => t.id === taskId);
    setData({
      ...data,
      items: data.items.map((t) => t.id === taskId ? { ...t, planned_date: plannedDate, planned_period_id: plannedDate ? data.period.id : t.planned_period_id } : t),
    });
    const res = await fetch(`/api/items/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (!res.ok) { toast.error("Не удалось переместить"); if (before) fetchAll(); }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const taskId = String(e.active.id);
    const dest = e.over?.id ? String(e.over.id) : null;
    if (!dest) return;
    if (dest === "backlog") moveTask(taskId, null);
    else moveTask(taskId, dest);
  };

  if (!data) return <div className="p-6 text-sm text-slate-500">Загрузка…</div>;

  const days = data.settings.weekend_days_visible ? DAYS_7 : DAYS_5;
  const weekStart = new Date(data.period.start_date);
  const dayDates: string[] = days.map((_, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(weekStart.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

  // Aggregate hours by day for capacity overload
  const hoursByDate: Record<string, number> = {};
  for (const t of data.items) {
    if (!t.planned_date) continue;
    hoursByDate[t.planned_date] = (hoursByDate[t.planned_date] ?? 0) + (t.estimated_minutes ?? 0) / 60;
  }

  return (
    <DndContext onDragEnd={onDragEnd}>
      <div className="flex h-[calc(100vh-3rem)]">
        {/* Sidebar */}
        <aside className="w-[320px] shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3">
          <Section title="Метрики недели">
            {data.metrics.length === 0 ? <Empty>Метрик нет</Empty> : data.metrics.map((m) => (
              <div key={m.id} className="rounded-md border border-slate-200 bg-white p-2 text-xs">
                <p className="font-medium">{m.title}</p>
                <p className="text-slate-500">Цель: {(data.targets_by_metric[m.id] ?? 0).toLocaleString("ru-RU")}{m.unit ? ` ${m.unit}` : ""}</p>
              </div>
            ))}
          </Section>
          <Section title="Инициативы">
            {data.initiatives.length === 0 ? <Empty>Инициатив нет</Empty> : data.initiatives.slice(0, 10).map((i) => (
              <div key={i.id} className="rounded-md border border-slate-200 bg-white p-2 text-xs">
                <p className="font-medium">{i.title}</p>
                <p className="text-slate-500">{i.status}</p>
              </div>
            ))}
          </Section>
          <Section title="Бэклог">
            <BacklogDroppable />
            {data.backlog.length === 0 ? <Empty>Бэклог пуст</Empty> : data.backlog.map((t) => <DraggableTask key={t.id} task={t} />)}
          </Section>
        </aside>

        {/* Day grid */}
        <main className="flex-1 overflow-auto p-4">
          <h1 className="mb-3 text-lg font-semibold">Неделя {data.period.week_n} · {data.period.start_date} → {data.period.end_date}</h1>
          <div className={`grid gap-3 ${data.settings.weekend_days_visible ? "grid-cols-7" : "grid-cols-5"}`}>
            {days.map((label, i) => {
              const date = dayDates[i];
              const hours = hoursByDate[date] ?? 0;
              const overload = hours > Number(data.settings.daily_capacity_hours);
              const dayItems = data.items.filter((t) => t.planned_date === date);
              return (
                <DayColumn key={date} label={label} date={date} hours={hours} overload={overload} tasks={dayItems} dailyCap={Number(data.settings.daily_capacity_hours)} />
              );
            })}
          </div>
        </main>
      </div>
    </DndContext>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-white px-2 py-1.5 text-xs text-slate-400">{children}</p>;
}

function BacklogDroppable() {
  const { isOver, setNodeRef } = useDroppable({ id: "backlog" });
  return <div ref={setNodeRef} className={`h-1.5 rounded ${isOver ? "bg-blue-300" : ""}`} />;
}

function DraggableTask({ task }: { task: Item }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className="cursor-grab rounded-md border border-slate-200 bg-white p-2 text-xs hover:bg-slate-50"
    >
      <div className="font-medium">{task.title}</div>
      {task.is_carryover && <div className="mt-0.5 text-[10px] font-semibold text-amber-600">↻ Перенос</div>}
      {task.estimated_minutes ? <div className="text-[10px] text-slate-500">{(task.estimated_minutes / 60).toFixed(1)}ч</div> : null}
    </div>
  );
}

function DayColumn({ label, date, hours, overload, tasks, dailyCap }: { label: string; date: string; hours: number; overload: boolean; tasks: Item[]; dailyCap: number }) {
  const { isOver, setNodeRef } = useDroppable({ id: date });
  return (
    <div ref={setNodeRef} className={`rounded-lg border ${overload ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"} ${isOver ? "ring-2 ring-blue-400" : ""}`}>
      <div className="flex items-center justify-between border-b border-inherit px-2 py-1.5">
        <span className="text-xs font-semibold">{label}</span>
        <span className={`text-[10px] tabular-nums ${overload ? "text-red-600" : "text-slate-500"}`}>
          {hours.toFixed(1)} / {dailyCap}ч
        </span>
      </div>
      <div className="flex flex-col gap-1.5 p-2">
        {tasks.length === 0 ? (
          <p className="text-center text-[10px] text-slate-400">—</p>
        ) : tasks.map((t) => <DraggableTask key={t.id} task={t} />)}
      </div>
    </div>
  );
}
