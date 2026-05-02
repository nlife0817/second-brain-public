"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBrainStore } from "@/lib/store";
import { formatHM, formatHMS } from "@/lib/timing-store";
import type { TimeEntry } from "@/types";
import { EditEntryDialog } from "@/components/timing/EditEntryDialog";

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
  if (target === today - 86_400_000) return "Вчера";
  return d.toLocaleDateString([], { weekday: "long", day: "2-digit", month: "long" });
}

function fmtIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function durationSec(e: TimeEntry): number {
  const endMs = e.ended_at ? new Date(e.ended_at).getTime() : Date.now();
  return Math.max(0, Math.floor((endMs - new Date(e.started_at).getTime()) / 1000));
}

export default function TimingPage() {
  const fetchInit = useBrainStore((s) => s.fetchInit);
  const items = useBrainStore((s) => s.items);

  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchInit();
  }, [fetchInit]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const from = startOfDay(date).toISOString();
    const to = endOfDay(date).toISOString();
    fetch(`/api/timing/entries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=500`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { entries: TimeEntry[] } | null) => {
        if (cancelled) return;
        setEntries(data?.entries ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, refreshKey]);

  const itemsById = useMemo(() => {
    const m = new Map<string, { title: string; category: string }>();
    for (const it of items) m.set(it.id, { title: it.title, category: it.category });
    return m;
  }, [items]);

  // Aggregate by item.
  const perItem = useMemo(() => {
    const m = new Map<string, { item_id: string; sec: number; sessions: number }>();
    for (const e of entries) {
      const key = e.item_id;
      const prev = m.get(key) ?? { item_id: key, sec: 0, sessions: 0 };
      prev.sec += durationSec(e);
      prev.sessions += 1;
      m.set(key, prev);
    }
    return [...m.values()].sort((a, b) => b.sec - a.sec);
  }, [entries]);

  const totalSec = useMemo(
    () => entries.reduce((acc, e) => acc + durationSec(e), 0),
    [entries],
  );

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить эту сессию?")) return;
    const res = await fetch(`/api/timing/entries/${id}`, { method: "DELETE" });
    if (res.ok) setRefreshKey((k) => k + 1);
  };

  const dateInputValue = fmtIsoDate(date);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold">Учёт времени</h1>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setDate((d) => new Date(d.getTime() - 86_400_000))}
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
              if (y && m && d) setDate(new Date(y, m - 1, d));
            }}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setDate((d) => new Date(d.getTime() + 86_400_000))}
            aria-label="Следующий день"
          >
            <ChevronRight />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-sm text-muted-foreground">{fmtDayHeader(date)}</div>
              <div className="font-mono tabular-nums text-3xl font-semibold">
                {totalSec > 0 ? formatHMS(totalSec) : "—"}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {entries.length} сессий · {perItem.length} задач
            </div>
          </div>

          {/* Per-item breakdown */}
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
                      <span className="flex-1 min-w-0 truncate">
                        {meta?.title ?? <em className="text-muted-foreground">удалённая задача</em>}
                      </span>
                      <span className="font-mono tabular-nums text-xs text-muted-foreground tabular-nums">
                        {formatHM(Math.round(row.sec / 60))}
                      </span>
                      <span className="text-[10px] text-muted-foreground tabular-nums w-9 text-right">
                        {pct}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Sessions */}
          <section className="space-y-1.5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Сессии
            </h2>
            {loading ? (
              <div className="text-sm text-muted-foreground py-4">Загрузка…</div>
            ) : entries.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4">
                За этот день нет сессий. Сессии можно добавить через карточку задачи (Detail → Время).
              </div>
            ) : (
              <ul className="rounded-lg border border-border bg-background">
                {[...entries]
                  .sort((a, b) => (a.started_at < b.started_at ? -1 : 1))
                  .map((e) => {
                    const meta = itemsById.get(e.item_id);
                    const start = new Date(e.started_at);
                    const end = e.ended_at ? new Date(e.ended_at) : null;
                    const fmt = (d: Date) =>
                      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    return (
                      <li
                        key={e.id}
                        className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0"
                      >
                        <span className="font-mono tabular-nums text-xs text-muted-foreground shrink-0">
                          {fmt(start)}–{end ? fmt(end) : "…"}
                        </span>
                        <span className="font-mono tabular-nums text-xs font-medium shrink-0">
                          {formatHMS(durationSec(e))}
                        </span>
                        <span className="flex-1 min-w-0 truncate">
                          {meta?.title ?? <em className="text-muted-foreground">удалённая задача</em>}
                        </span>
                        {e.note && (
                          <span className="text-xs text-muted-foreground truncate max-w-[160px]">
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
                            onClick={() => handleDelete(e.id)}
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
        onSaved={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
