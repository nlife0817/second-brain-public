"use client";

// Учёт времени: таймер, ручные записи, сводка за период.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/core/client";
import { useV2Store } from "@/lib/core/ui-store";

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

interface SummaryRow {
  key: string;
  label: string;
  seconds: number;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0 && m === 0) return `${seconds} с`;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

/** Локальная дата (не UTC): иначе ночью период и ручная запись съезжают на сутки. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function TimePage() {
  const { orgId, orgRole } = useV2Store();
  const isAdmin = orgRole === "owner" || orgRole === "admin";
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [active, setActive] = useState<TimeEntry | null>(null);
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([]);
  const [groupBy, setGroupBy] = useState<"task" | "project" | "user">("task");
  const [from, setFrom] = useState(isoDaysAgo(7));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  // Текущее время как состояние: чтение часов при рендере — недетерминированный
  // побочный эффект, счётчик должен обновляться тиком таймера.
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    // Промежуточное состояние <input type="date"> (пустая строка) не должно
    // уходить в API — вернётся 400 и мигнёт ошибка.
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) return;
    try {
      const [list, sum] = await Promise.all([
        api.get<{ entries: TimeEntry[]; active: TimeEntry | null }>(
          `/orgs/${orgId}/time?from=${from}&to=${to}`,
        ),
        api.get<SummaryRow[]>(`/orgs/${orgId}/time/summary?from=${from}&to=${to}&group_by=${groupBy}`),
      ]);
      setEntries(list.entries);
      setActive(list.active);
      setSummaryRows(sum);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить записи");
    }
  }, [orgId, from, to, groupBy]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const totalSeconds = summaryRows.reduce((acc, r) => acc + r.seconds, 0);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <h1 className="text-base font-semibold">Время</h1>
        <span className="flex-1" />
        {active ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm tabular-nums">{formatDuration(activeSeconds)}</span>
            <span className="max-w-48 truncate text-sm text-muted-foreground">
              {active.task_title || active.note || "Без задачи"}
            </span>
            <Button size="sm" variant="secondary" onClick={() => void call(() => api.del(`/orgs/${orgId}/time/timer`))}>
              <Pause className="size-4" />
              Стоп
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Над чем работаете?"
              className="h-8 w-56"
            />
            <Button
              size="sm"
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
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            />
            <span className="text-sm text-muted-foreground">—</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            />
            <Select value={groupBy} onValueChange={(v) => v && setGroupBy(v as typeof groupBy)}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue>
                  {groupBy === "task" ? "По задачам" : groupBy === "project" ? "По проектам" : "По сотрудникам"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="task">По задачам</SelectItem>
                <SelectItem value="project">По проектам</SelectItem>
                {isAdmin && <SelectItem value="user">По сотрудникам</SelectItem>}
              </SelectContent>
            </Select>
            <span className="ml-auto text-sm text-muted-foreground">
              Всего: <span className="font-medium text-foreground">{formatDuration(totalSeconds)}</span>
            </span>
          </div>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Сводка</h2>
            <div className="flex flex-col gap-2">
              {summaryRows.length === 0 && <p className="text-sm text-muted-foreground">За период записей нет</p>}
              {summaryRows.map((r) => (
                <div key={r.key} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{r.label}</span>
                  <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${totalSeconds ? (r.seconds / totalSeconds) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="w-24 text-right text-sm tabular-nums text-muted-foreground">
                    {formatDuration(r.seconds)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Записи</h2>
            <div className="flex flex-col gap-1.5">
              {entries.length === 0 && <p className="text-sm text-muted-foreground">Записей нет</p>}
              {entries.map((e) =>
                editing === e.id ? (
                  <EditEntryRow
                    key={e.id}
                    entry={e}
                    orgId={orgId}
                    onDone={() => {
                      setEditing(null);
                      void load();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div key={e.id} className="group flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 text-muted-foreground">
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
                    <span className="tabular-nums text-muted-foreground">
                      {e.seconds != null ? formatDuration(e.seconds) : "идёт"}
                    </span>
                    {e.ended_at && (
                      <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="Изменить"
                          onClick={() => setEditing(e.id)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="Удалить"
                          onClick={() => void call(() => api.del(`/orgs/${orgId}/time/${e.id}`))}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </span>
                    )}
                  </div>
                ),
              )}
            </div>
            <ManualEntryRow orgId={orgId} onAdded={() => void load()} />
          </section>
        </div>
      </div>
    </div>
  );
}

/** Правка готовой записи: границы интервала и комментарий. */
function EditEntryRow({
  entry,
  orgId,
  onDone,
  onCancel,
}: {
  entry: TimeEntry;
  orgId: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  // Значения полей — в локальном времени: пользователь вводит своё «10:00».
  const localDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const localTime = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const [date, setDate] = useState(() => localDate(entry.started_at));
  const [start, setStart] = useState(() => localTime(entry.started_at));
  const [end, setEnd] = useState(() => (entry.ended_at ? localTime(entry.ended_at) : "00:00"));
  const [note, setNote] = useState(entry.note);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!orgId) return;
    try {
      const startedAt = new Date(`${date}T${start}:00`);
      let endedAt = new Date(`${date}T${end}:00`);
      // Смена через полночь: конец раньше начала означает следующий день.
      if (endedAt <= startedAt) endedAt = new Date(endedAt.getTime() + 24 * 3600_000);
      await api.patch(`/orgs/${orgId}/time/${entry.id}`, {
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        note,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2 text-sm"
      />
      <input
        type="time"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2 text-sm"
      />
      <input
        type="time"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2 text-sm"
      />
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий" className="h-8 w-48" />
      <Button size="sm" onClick={() => void save()}>
        Сохранить
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Отмена
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}

function ManualEntryRow({ orgId, onAdded }: { orgId: string | null; onAdded: () => void }) {
  const [date, setDate] = useState(isoDaysAgo(0));
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!orgId) return;
    try {
      await api.post(`/orgs/${orgId}/time`, {
        started_at: new Date(`${date}T${start}:00`).toISOString(),
        ended_at: new Date(`${date}T${end}:00`).toISOString(),
        note,
      });
      setNote("");
      setError(null);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось добавить");
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2 text-sm"
      />
      <input
        type="time"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2 text-sm"
      />
      <input
        type="time"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2 text-sm"
      />
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий" className="h-8 w-56" />
      <Button size="sm" variant="outline" onClick={() => void add()}>
        <Plus className="size-4" />
        Добавить
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}
