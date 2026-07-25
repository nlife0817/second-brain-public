"use client";

// Учёт времени на мобильном: таймер старт/стоп и записи за период.
// Ручной ввод и сводки с группировками — на десктопе (/v2/time).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PullToRefresh } from "@/components/v2/mobile/PullToRefresh";
import { useAppResume } from "@/components/v2/mobile/hooks";
import { api } from "@/lib/core/client";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

interface TimeEntry {
  id: string;
  task_id: string | null;
  started_at: string;
  ended_at: string | null;
  seconds: number | null;
  source: "timer" | "manual";
  note: string;
  task_title: string | null;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0 && m === 0) return `${seconds} с`;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Локальная дата (не UTC): иначе ночью период съезжает на сутки. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PERIODS = [
  { key: "today", label: "Сегодня", days: 0 },
  { key: "week", label: "7 дней", days: 6 },
  { key: "month", label: "30 дней", days: 29 },
] as const;

export default function MobileTimePage() {
  const { orgId } = useV2Store();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [active, setActive] = useState<TimeEntry | null>(null);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("today");
  const [note, setNote] = useState("");
  // Текущее время как состояние: чтение часов при рендере — недетерминированный
  // побочный эффект, счётчик должен обновляться тиком таймера.
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  const days = PERIODS.find((p) => p.key === period)?.days ?? 0;

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await api.get<{ entries: TimeEntry[]; active: TimeEntry | null }>(
        `/orgs/${orgId}/time?from=${isoDaysAgo(days)}&to=${isoDaysAgo(0)}`,
      );
      setEntries(res.entries);
      setActive(res.active);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить записи");
    }
  }, [orgId, days]);

  useEffect(() => {
    void load();
  }, [load]);

  // Таймер мог остановиться с другого устройства, пока приложение было в фоне.
  useAppResume(load);

  // Секундная стрелка активного таймера.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  const activeSeconds = useMemo(() => {
    if (!active) return 0;
    return Math.max(0, Math.floor((now - new Date(active.started_at).getTime()) / 1000));
  }, [active, now]);

  async function call(fn: () => Promise<unknown>) {
    try {
      await fn();
      await load();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  const totalSeconds = entries.reduce((acc, e) => acc + (e.seconds ?? 0), 0);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold">Время</h1>
      </header>

      <PullToRefresh onRefresh={load} className="px-4 py-3">
        <div className="flex flex-col gap-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0 flex-1">{error}</span>
              <button onClick={() => void load()} className="shrink-0 font-medium underline">
                Повторить
              </button>
            </div>
          )}

          <section className="rounded-2xl border border-border bg-card p-4">
            {active ? (
              <div className="flex flex-col items-center gap-3">
                <p className="font-mono text-4xl font-semibold tabular-nums">{formatClock(activeSeconds)}</p>
                <p className="max-w-full truncate text-sm text-muted-foreground">
                  {active.task_title || active.note || "Без задачи"}
                </p>
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={() => void call(() => api.del(`/orgs/${orgId}/time/timer`))}
                >
                  <Pause className="size-4" />
                  Остановить
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Над чем работаете?"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none placeholder:text-muted-foreground"
                />
                <Button
                  className="w-full"
                  onClick={() =>
                    void call(async () => {
                      await api.post(`/orgs/${orgId}/time/timer`, { note });
                      setNote("");
                    })
                  }
                >
                  <Play className="size-4" />
                  Старт
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Таймер по конкретной задаче запускается из её карточки
                </p>
              </div>
            )}
          </section>

          <div className="flex items-center gap-1.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium",
                  period === p.key
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground">
              Всего: <span className="font-medium text-foreground">{formatDuration(totalSeconds)}</span>
            </span>
          </div>

          <section className="flex flex-col gap-1">
            {entries.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">За период записей нет</p>
            )}
            {entries.map((e) => (
              <div key={e.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 text-sm">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">
                  {new Date(e.started_at).toLocaleString("ru-RU", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {e.task_title || e.note || <span className="text-muted-foreground">Без задачи</span>}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {e.seconds != null ? formatDuration(e.seconds) : "идёт"}
                </span>
                {e.ended_at && (
                  <button
                    onClick={() => void call(() => api.del(`/orgs/${orgId}/time/${e.id}`))}
                    className="rounded-lg p-2 text-muted-foreground active:bg-muted"
                    aria-label="Удалить запись"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </section>
        </div>
      </PullToRefresh>
    </div>
  );
}
