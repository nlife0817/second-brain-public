"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBrainStore } from "@/lib/store";
import { formatHM, formatHMS, useTimingStore } from "@/lib/timing-store";
import type { TimeEntry } from "@/types";
import { EditEntryDialog } from "@/components/timing/EditEntryDialog";

const DAY_MS = 86_400_000;

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

function fmtIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function durationSec(e: TimeEntry, nowMs: number): number {
  const endMs = e.ended_at ? new Date(e.ended_at).getTime() : nowMs;
  return Math.max(0, Math.floor((endMs - new Date(e.started_at).getTime()) / 1000));
}

export function TimingView() {
  const fetchInit = useBrainStore((s) => s.fetchInit);
  const items = useBrainStore((s) => s.items);
  const refreshTotals = useTimingStore((s) => s.refreshTotals);

  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
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

  useEffect(() => {
    const ctrl = new AbortController();

    const from = startOfDay(date).toISOString();
    const to = endOfDay(date).toISOString();
    fetch(`/api/timing/entries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=500`, {
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
  }, [date, refreshKey]);

  const itemsById = useMemo(() => {
    const m = new Map<string, { title: string; category: string }>();
    for (const it of items) m.set(it.id, { title: it.title, category: it.category });
    return m;
  }, [items]);

  const perItem = useMemo(() => {
    const m = new Map<string, { item_id: string; sec: number; sessions: number }>();
    for (const e of entries) {
      const prev = m.get(e.item_id) ?? { item_id: e.item_id, sec: 0, sessions: 0 };
      prev.sec += durationSec(e, nowMs);
      prev.sessions += 1;
      m.set(e.item_id, prev);
    }
    return [...m.values()].sort((a, b) => b.sec - a.sec);
  }, [entries, nowMs]);

  const totalSec = useMemo(
    () => entries.reduce((acc, e) => acc + durationSec(e, nowMs), 0),
    [entries, nowMs],
  );

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить эту сессию?")) return;
    setError(null);
    const res = await fetch(`/api/timing/entries/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(`Не удалось удалить сессию: ${res.status}`);
      return;
    }
    setLoading(true);
    setRefreshKey((k) => k + 1);
    void refreshTotals();
  };

  const queueReload = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  const shiftDate = (days: number) => {
    setLoading(true);
    setError(null);
    setDate((d) => new Date(d.getTime() + days * DAY_MS));
  };

  const dateInputValue = fmtIsoDate(date);

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold">Учет времени</h1>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => shiftDate(-1)}
            aria-label="Предыдущий день"
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
            onClick={() => shiftDate(1)}
            aria-label="Следующий день"
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
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <div className="text-sm capitalize text-muted-foreground">{fmtDayHeader(date)}</div>
              <div className="font-mono text-3xl font-semibold tabular-nums">
                {totalSec > 0 ? formatHMS(totalSec) : "-"}
              </div>
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              {entries.length} сессий · {perItem.length} задач
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {perItem.length > 0 && (
            <section className="space-y-1.5">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                По задачам
              </h2>
              <ul className="rounded-lg border border-border bg-background">
                {perItem.map((row) => {
                  const meta = itemsById.get(row.item_id);
                  const pct = totalSec > 0 ? Math.round((row.sec / totalSec) * 100) : 0;
                  return (
                    <li
                      key={row.item_id}
                      className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {meta?.title ?? (
                          <em className="text-muted-foreground">удаленная задача</em>
                        )}
                      </span>
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

          <section className="space-y-1.5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Сессии
            </h2>
            {loading ? (
              <div className="py-4 text-sm text-muted-foreground">Загрузка...</div>
            ) : entries.length === 0 ? (
              <div className="py-4 text-sm text-muted-foreground">
                За этот день нет сессий. Сессии можно добавить через карточку задачи: Детали → Время.
              </div>
            ) : (
              <ul className="rounded-lg border border-border bg-background">
                {[...entries]
                  .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
                  .map((e) => {
                    const meta = itemsById.get(e.item_id);
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
                          {fmt(start)}-{end ? fmt(end) : "..."}
                        </span>
                        <span className="shrink-0 font-mono text-xs font-medium tabular-nums">
                          {formatHMS(durationSec(e, nowMs))}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {meta?.title ?? (
                            <em className="text-muted-foreground">удаленная задача</em>
                          )}
                        </span>
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
