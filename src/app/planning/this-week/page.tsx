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
import type { Item, DevelopmentParticipant } from "@/types";
import type {
  PlanningPeriod,
  PlanningSettings,
  PlanningInitiative,
  PlanningMetric,
  PlanningInitiativeMetricLink,
  EffectiveCapacity,
} from "@/types/planning";
import { INITIATIVE_STATUS_LABEL, SEMANTIC_CLASS, initiativeStatusTone } from "@/lib/planning-colors";
import { formatMetricValue } from "@/lib/planning-format";
import { WeekCascadePicker } from "@/components/planning/WeekCascadePicker";
import { ParticipantAvatar } from "@/components/planning/ParticipantAvatar";
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
  participants: DevelopmentParticipant[];
  effective_capacities: EffectiveCapacity[];
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

/** Парсинг droppable id: "backlog" | `${participantId}|${date}` */
function parseDropTarget(id: string): { backlog: boolean; participantId?: string; date?: string } {
  if (id === "backlog") return { backlog: true };
  const pipe = id.indexOf("|");
  if (pipe < 0) return { backlog: false };
  return { backlog: false, participantId: id.slice(0, pipe), date: id.slice(pipe + 1) };
}

function dropId(participantId: string, date: string): string {
  return `${participantId}|${date}`;
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

  const effectiveWeek = useMemo(() => {
    if (weekParam && parseWeekKey(weekParam)) return weekParam;
    return currentWeekKey();
  }, [weekParam]);

  const effectiveDirection = directionParam ?? selectedDirectionId ?? null;

  const [data, setData] = useState<ThisWeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backlogAssigneeFilter, setBacklogAssigneeFilter] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!storeLoaded) fetchAllStore();
  }, [storeLoaded, fetchAllStore]);

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

  // Универсальный апдейт задачи (planned_date + assignee).
  const moveTask = async (
    taskId: string,
    next: { planned_date: string | null; assignee_participant_id?: string },
  ) => {
    if (!data) return;
    const update: {
      planned_date: string | null;
      planned_period_id?: string;
      assignee_participant_id?: string;
    } = { planned_date: next.planned_date };
    if (next.planned_date) update.planned_period_id = data.period.id;
    if (next.assignee_participant_id) update.assignee_participant_id = next.assignee_participant_id;

    // Optimistic — изменим items и/или backlog.
    setData((prev) => {
      if (!prev) return prev;
      // Перенос из бэклога в день: удалить из backlog, добавить в items с новыми полями.
      const fromBacklog = prev.backlog.find((t) => t.id === taskId);
      const fromItems = prev.items.find((t) => t.id === taskId);
      if (next.planned_date === null) {
        // Вернули в бэклог
        if (!fromItems) return prev;
        return {
          ...prev,
          items: prev.items.filter((t) => t.id !== taskId),
          backlog: [{ ...fromItems, planned_date: null, planned_period_id: null }, ...prev.backlog],
        };
      }
      const target = fromItems ?? fromBacklog;
      if (!target) return prev;
      const merged: Item = {
        ...target,
        planned_date: next.planned_date,
        planned_period_id: prev.period.id,
        ...(next.assignee_participant_id ? { assignee_participant_id: next.assignee_participant_id } : {}),
      };
      return {
        ...prev,
        items: fromItems
          ? prev.items.map((t) => (t.id === taskId ? merged : t))
          : [...prev.items, merged],
        backlog: prev.backlog.filter((t) => t.id !== taskId),
      };
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
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    const t = parseDropTarget(overId);
    if (t.backlog) {
      moveTask(taskId, { planned_date: null });
      return;
    }
    if (t.date && t.participantId) {
      moveTask(taskId, { planned_date: t.date, assignee_participant_id: t.participantId });
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

  // Indexes
  const participantById = new Map(data.participants.map((p) => [p.id, p]));
  const effCapById = new Map(data.effective_capacities.map((c) => [c.participant_id, c]));

  const owner = data.participants.find((p) => p.role === "owner") ?? null;
  // Активные developer-участники + те developer-ы, у кого есть задачи в этой неделе
  const devsWithTasks = new Set(
    data.items
      .map((t) => t.assignee_participant_id)
      .filter((id): id is string => !!id && participantById.get(id)?.role === "developer"),
  );
  const developers = data.participants
    .filter((p) => p.role === "developer" && (p.is_active || devsWithTasks.has(p.id)))
    .sort((a, b) => a.position - b.position);

  const othersWithTasks = new Set(
    data.items
      .map((t) => t.assignee_participant_id)
      .filter((id): id is string => !!id && participantById.get(id)?.role === "other"),
  );
  const others = data.participants
    .filter((p) => p.role === "other" && (othersWithTasks.has(p.id)))
    .sort((a, b) => a.position - b.position);

  // Сводка часов: hoursByParticipantDate[pid][date]
  const hoursByPidDate: Record<string, Record<string, number>> = {};
  for (const t of data.items) {
    if (!t.planned_date || !t.assignee_participant_id) continue;
    const pid = t.assignee_participant_id;
    const date = t.planned_date;
    hoursByPidDate[pid] ??= {};
    hoursByPidDate[pid][date] = (hoursByPidDate[pid][date] ?? 0) + (t.estimated_minutes ?? 0) / 60;
  }
  const totalHoursOf = (pid: string) =>
    Object.values(hoursByPidDate[pid] ?? {}).reduce((s, h) => s + h, 0);

  // capacity для секции «Разработка» — сумма активных developer
  const devCap = developers.reduce((s, p) => s + (effCapById.get(p.id)?.hours ?? 0), 0);
  const devUsed = developers.reduce((s, p) => s + totalHoursOf(p.id), 0);

  const totalHoursWeek = data.items.reduce((s, t) => s + (t.estimated_minutes ?? 0) / 60, 0);
  const weeklyCap = Number(data.settings.weekly_capacity_hours ?? 40);
  const carryoverCount = data.items.filter((t) => t.is_carryover && t.status !== "done").length;

  const parsedWeek = parseWeekKey(effectiveWeek);
  const pickerWeekKey = parsedWeek
    ? weekKey(parsedWeek.year, parsedWeek.week)
    : currentWeekKey();
  const pickerStart = parsedWeek ? weekStartDate(parsedWeek.year, parsedWeek.week) : new Date(data.period.start_date);
  void pickerStart;

  // Filtered backlog
  const filteredBacklog = backlogAssigneeFilter.size === 0
    ? data.backlog
    : data.backlog.filter((t) => t.assignee_participant_id && backlogAssigneeFilter.has(t.assignee_participant_id));

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
              {/* Assignee filter chips */}
              {data.participants.length > 1 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {data.participants.filter((p) => p.is_active || backlogAssigneeFilter.has(p.id)).map((p) => {
                    const on = backlogAssigneeFilter.has(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          setBacklogAssigneeFilter((prev) => {
                            const next = new Set(prev);
                            if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                            return next;
                          });
                        }}
                        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] transition-colors ${
                          on ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                        title={`Показывать только ${p.name}`}
                      >
                        <ParticipantAvatar participant={p} size="xs" />
                        <span>{p.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <BacklogDroppable />
              {filteredBacklog.length === 0 ? (
                <Empty>{data.backlog.length === 0 ? "Бэклог пуст" : "По фильтру ничего"}</Empty>
              ) : (
                <>
                  <p className="mb-1 text-[10px] text-slate-400">Перетащите в день →</p>
                  {filteredBacklog.map((t) => (
                    <DraggableTask key={t.id} task={t} participant={t.assignee_participant_id ? participantById.get(t.assignee_participant_id) : undefined} />
                  ))}
                </>
              )}
            </Section>
          </aside>

          {/* Day grid — две секции */}
          <main className="flex-1 overflow-auto p-4">
            {/* Header дней — единый */}
            <DayHeader days={days} dayDates={dayDates} today={today} dailyCap={Number(data.settings.daily_capacity_hours)} />

            {/* Секция «Моя» */}
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
                  items={data.items.filter((t) => t.assignee_participant_id === owner.id)}
                  dailyCap={Number(data.settings.daily_capacity_hours)}
                  participants={data.participants}
                  participantById={participantById}
                  showAvatar={false}
                />
              </SectionBlock>
            )}

            {/* Секция «Разработка» */}
            <SectionBlock title="Разработка" used={devUsed} cap={devCap}>
              {developers.length === 0 ? (
                <p className="rounded-md bg-slate-50 px-2 py-2 text-xs text-slate-400">Нет активных разработчиков. Добавьте их в Настройках.</p>
              ) : developers.map((p) => (
                <ParticipantRow
                  key={p.id}
                  participant={p}
                  days={days}
                  dayDates={dayDates}
                  today={today}
                  items={data.items.filter((t) => t.assignee_participant_id === p.id)}
                  dailyCap={Number(data.settings.daily_capacity_hours)}
                  effectiveCapHours={effCapById.get(p.id)?.hours ?? 0}
                  participants={data.participants}
                  participantById={participantById}
                  showAvatar
                />
              ))}
            </SectionBlock>

            {/* Секция «Прочее» */}
            {others.length > 0 && (
              <SectionBlock title="Прочее" muted>
                {others.map((p) => (
                  <ParticipantRow
                    key={p.id}
                    participant={p}
                    days={days}
                    dayDates={dayDates}
                    today={today}
                    items={data.items.filter((t) => t.assignee_participant_id === p.id)}
                    dailyCap={Number(data.settings.daily_capacity_hours)}
                    effectiveCapHours={effCapById.get(p.id)?.hours ?? 0}
                    participants={data.participants}
                    participantById={participantById}
                    showAvatar
                  />
                ))}
              </SectionBlock>
            )}

            {data.items.length === 0 && (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4 text-center text-xs text-slate-500">
                На неделе пока нет задач. Перетащите из бэклога.
              </div>
            )}
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

function DayHeader({
  days, dayDates, today, dailyCap,
}: { days: string[]; dayDates: string[]; today: string; dailyCap: number }) {
  return (
    <div className="sticky top-0 z-10 mb-2 grid grid-cols-[120px_1fr] gap-2 bg-white/95 backdrop-blur">
      <div />
      <div
        className="grid gap-2"
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
    <div className={`mb-4 rounded-lg border ${muted ? "border-slate-100" : "border-slate-200"} ${muted ? "bg-slate-50/40" : "bg-white"}`}>
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
  participant, days, dayDates, today, items, dailyCap,
  effectiveCapHours, participants, participantById, showAvatar,
}: {
  participant: DevelopmentParticipant;
  days: string[];
  dayDates: string[];
  today: string;
  items: Item[];
  dailyCap: number;
  effectiveCapHours?: number;
  participants: DevelopmentParticipant[];
  participantById: Map<string, DevelopmentParticipant>;
  showAvatar: boolean;
}) {
  const total = items.reduce((s, t) => s + (t.estimated_minutes ?? 0) / 60, 0);
  const inactive = participant.is_active === false;
  return (
    <div className="mb-2 grid grid-cols-[120px_1fr] gap-2">
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
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))` }}
      >
        {dayDates.map((date) => {
          const hours = items
            .filter((t) => t.planned_date === date)
            .reduce((s, t) => s + (t.estimated_minutes ?? 0) / 60, 0);
          const dayItems = items.filter((t) => t.planned_date === date);
          return (
            <DayCell
              key={date}
              participantId={participant.id}
              date={date}
              isToday={date === today}
              hours={hours}
              dailyCap={dailyCap}
              tasks={dayItems}
              participantById={participantById}
              participants={participants}
            />
          );
        })}
      </div>
    </div>
  );
}

function DayCell({
  participantId, date, isToday, hours, dailyCap, tasks, participantById,
}: {
  participantId: string;
  date: string;
  isToday: boolean;
  hours: number;
  dailyCap: number;
  tasks: Item[];
  participantById: Map<string, DevelopmentParticipant>;
  participants: DevelopmentParticipant[];
}) {
  const { isOver, setNodeRef } = useDroppable({ id: dropId(participantId, date) });
  const overload = hours > dailyCap;
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[80px] flex-col rounded-md border ${
        overload ? "border-red-300 bg-red-50/50" : "border-slate-200 bg-white"
      } ${isOver ? "ring-2 ring-blue-400" : ""} ${isToday ? "ring-1 ring-blue-200" : ""}`}
    >
      {hours > 0 && (
        <div className={`flex justify-end border-b border-inherit px-1.5 py-0.5 text-[9px] tabular-nums ${overload ? "font-semibold text-red-600" : "text-slate-400"}`}>
          {hours.toFixed(1)}ч
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1 p-1">
        {tasks.map((t) => (
          <DraggableTask
            key={t.id}
            task={t}
            participant={t.assignee_participant_id ? participantById.get(t.assignee_participant_id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function DraggableTask({ task, participant }: { task: Item; participant: DevelopmentParticipant | undefined }) {
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
      className={`cursor-grab rounded-md border bg-white p-1.5 text-[11px] hover:bg-slate-50 ${
        isDone ? "border-slate-100 opacity-60" : "border-slate-200"
      }`}
    >
      <div className="flex items-start gap-1">
        <ParticipantAvatar participant={participant} size="xs" />
        <div className={`flex-1 font-medium leading-tight ${isDone ? "line-through" : ""}`}>{task.title}</div>
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
      </div>
    </div>
  );
}
