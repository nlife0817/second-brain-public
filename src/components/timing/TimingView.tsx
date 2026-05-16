"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBrainStore } from "@/lib/store";
import { formatHM, formatHMS, useTimingStore } from "@/lib/timing-store";
import type { Category, Item, ItemWithSubtasks, TimeEntry } from "@/types";
import { EditEntryDialog } from "@/components/timing/EditEntryDialog";

const DAY_MS = 86_400_000;
const FALLBACK_COLORS = ["#0f766e", "#2563eb", "#9333ea", "#dc2626", "#ca8a04", "#475569", "#16a34a"];

type PeriodMode = "day" | "week";

interface ItemMeta {
  id: string;
  title: string;
  category: string;
  status: Item["status"];
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return startOfDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday));
}

function endOfWeek(d: Date): Date {
  const start = startOfWeek(d);
  return endOfDay(new Date(start.getTime() + 6 * DAY_MS));
}

function fmtIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDayHeader(d: Date): string {
  const today = startOfDay(new Date()).getTime();
  const target = startOfDay(d).getTime();
  if (target === today) return "Сегодня";
  if (target === today - DAY_MS) return "Вчера";
  return d.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

function fmtRange(start: Date, end: Date): string {
  return `${start.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" })} - ${end.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" })}`;
}

function durationSec(e: TimeEntry, nowMs: number): number {
  const endMs = e.ended_at ? new Date(e.ended_at).getTime() : nowMs;
  return Math.max(0, Math.floor((endMs - new Date(e.started_at).getTime()) / 1000));
}

function addItemToIndex(map: Map<string, ItemMeta>, item: ItemWithSubtasks | Item) {
  map.set(item.id, {
    id: item.id,
    title: item.title,
    category: item.category,
    status: item.status,
  });
  const subtasks = "subtasks" in item ? item.subtasks : undefined;
  if (subtasks) {
    for (const subtask of subtasks) addItemToIndex(map, subtask);
  }
}

export function TimingView() {
  const fetchInit = useBrainStore((s) => s.fetchInit);
  const items = useBrainStore((s) => s.items);
  const categories = useBrainStore((s) => s.categories);
  const openDetail = useBrainStore((s) => s.openDetail);
  const refreshTotals = useTimingStore((s) => s.refreshTotals);

  const [periodMode, setPeriodMode] = useState<PeriodMode>("day");
  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    void fetchInit();
  }, [fetchInit]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const range = useMemo(() => {
    if (periodMode === "week") {
      return { from: startOfWeek(date), to: endOfWeek(date) };
    }
    return { from: startOfDay(date), to: endOfDay(date) };
  }, [date, periodMode]);

  useEffect(() => {
    const ctrl = new AbortController();
    const from = range.from.toISOString();
    const to = range.to.toISOString();

    fetch(`/api/timing/entries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=1000`, {
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Не удалось загрузить сессии: ${r.status}`);
        return (await r.json()) as { entries: TimeEntry[] };
      })
      .then((data) => setEntries(data.entries ?? []))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setEntries([]);
        setError(err instanceof Error ? err.message : "Не удалось загрузить сессии");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });

    return () => ctrl.abort();
  }, [range, refreshKey]);

  const itemsById = useMemo(() => {
    const m = new Map<string, ItemMeta>();
    for (const it of items) addItemToIndex(m, it);
    return m;
  }, [items]);

  const categoryById = useMemo(() => {
    const m = new Map<string, Category>();
    for (const category of categories) m.set(category.id, category);
    return m;
  }, [categories]);

  const enrichedEntries = useMemo(() => {
    return entries.map((entry) => ({
      entry,
      sec: durationSec(entry, nowMs),
      meta: itemsById.get(entry.item_id) ?? null,
    }));
  }, [entries, itemsById, nowMs]);

  const totalSec = useMemo(
    () => enrichedEntries.reduce((acc, row) => acc + row.sec, 0),
    [enrichedEntries],
  );

  const perItem = useMemo(() => {
    const m = new Map<string, { item_id: string; sec: number; sessions: number; meta: ItemMeta | null }>();
    for (const row of enrichedEntries) {
      const prev = m.get(row.entry.item_id) ?? {
        item_id: row.entry.item_id,
        sec: 0,
        sessions: 0,
        meta: row.meta,
      };
      prev.sec += row.sec;
      prev.sessions += 1;
      if (!prev.meta && row.meta) prev.meta = row.meta;
      m.set(row.entry.item_id, prev);
    }
    return [...m.values()].sort((a, b) => b.sec - a.sec);
  }, [enrichedEntries]);

  const categoryRows = useMemo(() => {
    const m = new Map<string, { id: string; label: string; color: string; sec: number }>();
    for (const row of enrichedEntries) {
      const categoryId = row.meta?.category ?? "unknown";
      const category = categoryById.get(categoryId);
      const prev = m.get(categoryId) ?? {
        id: categoryId,
        label: category?.name ?? "Без категории",
        color: category?.color || FALLBACK_COLORS[m.size % FALLBACK_COLORS.length],
        sec: 0,
      };
      prev.sec += row.sec;
      m.set(categoryId, prev);
    }
    return [...m.values()].filter((row) => row.sec > 0).sort((a, b) => b.sec - a.sec);
  }, [categoryById, enrichedEntries]);

  const weekRows = useMemo(() => {
    const start = startOfWeek(date);
    return Array.from({ length: 7 }, (_, i) => {
      const day = startOfDay(new Date(start.getTime() + i * DAY_MS));
      const dayKey = fmtIsoDate(day);
      const sec = enrichedEntries.reduce((acc, row) => {
        return fmtIsoDate(new Date(row.entry.started_at)) === dayKey ? acc + row.sec : acc;
      }, 0);
      return { day, sec };
    });
  }, [date, enrichedEntries]);

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить эту сессию?")) return;
    setError(null);
    const res = await fetch(`/api/timing/entries/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(`Не удалось удалить сессию: ${res.status}`);
      return;
    }
    queueReload();
    void refreshTotals();
  };

  const queueReload = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  const shiftPeriod = (direction: -1 | 1) => {
    setLoading(true);
    setError(null);
    const delta = periodMode === "week" ? 7 * DAY_MS : DAY_MS;
    setDate((d) => new Date(d.getTime() + direction * delta));
  };

  const changeMode = (mode: PeriodMode) => {
    if (mode === periodMode) return;
    setLoading(true);
    setError(null);
    setPeriodMode(mode);
  };

  const dateInputValue = fmtIsoDate(date);
  const title = periodMode === "week" ? fmtRange(range.from, range.to) : fmtDayHeader(date);

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold">Учет времени</h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md border border-input bg-background p-0.5">
            <button
              type="button"
              onClick={() => changeMode("day")}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium",
                periodMode === "day" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              День
            </button>
            <button
              type="button"
              onClick={() => changeMode("week")}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium",
                periodMode === "week" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              Неделя
            </button>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => shiftPeriod(-1)}
            aria-label={periodMode === "week" ? "Предыдущая неделя" : "Предыдущий день"}
          >
            <ChevronLeft />
          </Button>
          <input
            type="date"
            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
            value={dateInputValue}
            onChange={(e) => {
              const [y, m, d] = e.target.value.split("-").map(Number);
              if (y && m && d) {
                setLoading(true);
                setError(null);
                setDate(new Date(y, m - 1, d));
              }
            }}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => shiftPeriod(1)}
            aria-label={periodMode === "week" ? "Следующая неделя" : "Следующий день"}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={queueReload}
            aria-label="Обновить"
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <section className="rounded-lg border border-border bg-background p-4">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <div className="text-sm capitalize text-muted-foreground">{title}</div>
                    <div className="font-mono text-3xl font-semibold tabular-nums">
                      {totalSec > 0 ? formatHMS(totalSec) : "-"}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">
                    {entries.length} сессий · {perItem.length} задач
                  </div>
                </div>
              </section>

              {periodMode === "week" && <WeekHistogram rows={weekRows} />}

              {perItem.length > 0 && (
                <section className="space-y-1.5">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    По задачам
                  </h2>
                  <ul className="rounded-lg border border-border bg-background">
                    {perItem.map((row) => {
                      const pct = totalSec > 0 ? Math.round((row.sec / totalSec) * 100) : 0;
                      return (
                        <li
                          key={row.item_id}
                          className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0"
                        >
                          {row.meta ? (
                            <button
                              type="button"
                              onClick={() => openDetail(row.item_id)}
                              className="group min-w-0 flex-1 truncate text-left text-slate-800 hover:text-violet-700"
                              title={row.meta.title}
                            >
                              <span className="truncate">{row.meta.title}</span>
                              {row.meta.status === "archived" && (
                                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                  архив
                                </span>
                              )}
                              <ExternalLink className="ml-1 inline size-3 opacity-0 transition-opacity group-hover:opacity-60" />
                            </button>
                          ) : (
                            <span className="min-w-0 flex-1 truncate">
                              <em className="text-muted-foreground">задача не найдена в текущей загрузке</em>
                            </span>
                          )}
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">
                            {formatHM(Math.round(row.sec / 60))}
                          </span>
                          <span className="w-9 text-right text-[10px] text-muted-foreground tabular-nums">
                            {pct}%
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>

            <CategoryDonut rows={categoryRows} totalSec={totalSec} />
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <section className="space-y-1.5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Сессии
            </h2>
            {loading ? (
              <div className="py-4 text-sm text-muted-foreground">Загрузка...</div>
            ) : entries.length === 0 ? (
              <div className="py-4 text-sm text-muted-foreground">
                За выбранный период нет сессий. Сессии можно добавить через карточку задачи: Детали → Время.
              </div>
            ) : (
              <ul className="rounded-lg border border-border bg-background">
                {[...entries]
                  .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
                  .map((e) => {
                    const meta = itemsById.get(e.item_id) ?? null;
                    const start = new Date(e.started_at);
                    const end = e.ended_at ? new Date(e.ended_at) : null;
                    const fmt = (d: Date) =>
                      d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
                    return (
                      <li
                        key={e.id}
                        className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0"
                      >
                        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                          {periodMode === "week" && (
                            <span className="mr-1">{start.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}</span>
                          )}
                          {fmt(start)}-{end ? fmt(end) : "..."}
                        </span>
                        <span className="shrink-0 font-mono text-xs font-medium tabular-nums">
                          {formatHMS(durationSec(e, nowMs))}
                        </span>
                        {meta ? (
                          <button
                            type="button"
                            onClick={() => openDetail(e.item_id)}
                            className="min-w-0 flex-1 truncate text-left hover:text-violet-700"
                            title={meta.title}
                          >
                            {meta.title}
                            {meta.status === "archived" && (
                              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                архив
                              </span>
                            )}
                          </button>
                        ) : (
                          <span className="min-w-0 flex-1 truncate">
                            <em className="text-muted-foreground">задача не найдена в текущей загрузке</em>
                          </span>
                        )}
                        {e.note && (
                          <span className="max-w-[160px] truncate text-xs text-muted-foreground">
                            · {e.note}
                          </span>
                        )}
                        {end && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setEditing(e)}
                            aria-label="Редактировать"
                          >
                            <Pencil />
                          </Button>
                        )}
                        {end && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => void handleDelete(e.id)}
                            aria-label="Удалить"
                            className="text-red-500"
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>
        </div>
      </div>

      <EditEntryDialog
        entry={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          queueReload();
          void refreshTotals();
        }}
      />
    </div>
  );
}

function WeekHistogram({ rows }: { rows: Array<{ day: Date; sec: number }> }) {
  const maxSec = Math.max(1, ...rows.map((row) => row.sec));

  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Время по дням
      </h2>
      <div className="mt-4 grid h-44 grid-cols-7 items-end gap-2">
        {rows.map((row) => {
          const height = Math.max(row.sec > 0 ? 10 : 2, Math.round((row.sec / maxSec) * 132));
          return (
            <div key={row.day.toISOString()} className="flex h-full min-w-0 flex-col items-center justify-end gap-2">
              <div className="font-mono text-[10px] text-slate-500 tabular-nums">
                {row.sec > 0 ? formatHM(Math.round(row.sec / 60)) : ""}
              </div>
              <div
                className="w-full rounded-t-md bg-violet-500/80 transition-[height]"
                style={{ height }}
                title={formatHM(Math.round(row.sec / 60))}
              />
              <div className="text-center text-[10px] leading-tight text-slate-500">
                <div>{row.day.toLocaleDateString("ru-RU", { weekday: "short" })}</div>
                <div>{row.day.toLocaleDateString("ru-RU", { day: "2-digit" })}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CategoryDonut({
  rows,
  totalSec,
}: {
  rows: Array<{ id: string; label: string; color: string; sec: number }>;
  totalSec: number;
}) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const segments = rows.reduce<Array<{ id: string; color: string; length: number; offset: number }>>(
    (acc, row) => {
      const length = totalSec > 0 ? (row.sec / totalSec) * circumference : 0;
      const offset = acc.reduce((sum, segment) => sum + segment.length, 0);
      acc.push({ id: row.id, color: row.color, length, offset });
      return acc;
    },
    [],
  );

  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        По категориям
      </h2>
      {rows.length === 0 ? (
        <div className="py-10 text-sm text-muted-foreground">Нет данных</div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="relative mx-auto size-44">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90">
              <circle cx="60" cy="60" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="14" />
              {segments.map((segment) => (
                <circle
                  key={segment.id}
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth="14"
                  strokeDasharray={`${segment.length} ${circumference - segment.length}`}
                  strokeDashoffset={-segment.offset}
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="font-mono text-lg font-semibold tabular-nums">
                {formatHM(Math.round(totalSec / 60))}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">итого</span>
            </div>
          </div>
          <div className="space-y-2">
            {rows.map((row) => {
              const pct = Math.round((row.sec / totalSec) * 100);
              return (
                <div key={row.id} className="flex items-center gap-2 text-xs">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {formatHM(Math.round(row.sec / 60))}
                  </span>
                  <span className="w-8 text-right text-slate-400">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
