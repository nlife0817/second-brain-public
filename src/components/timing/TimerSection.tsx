"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Play, Square, Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useBrainStore } from "@/lib/store";
import { useTimingStore, formatHMS, formatHM } from "@/lib/timing-store";
import type { ItemWithSubtasks, ItemTimeTotals, TimeEntry } from "@/types";
import { ManualEntryDialog } from "./ManualEntryDialog";
import { EditEntryDialog } from "./EditEntryDialog";

interface Props {
  item: ItemWithSubtasks;
  layout: "modal" | "panel";
}

interface EntriesResponse {
  entries: TimeEntry[];
  totals: ItemTimeTotals | null;
}

export function TimerSection({ item, layout }: Props) {
  const activeEntry = useTimingStore((s) => s.activeEntry);
  const start = useTimingStore((s) => s.start);
  const stop = useTimingStore((s) => s.stop);
  const elapsedFn = useTimingStore((s) => s.elapsedSeconds);
  const updateItem = useBrainStore((s) => s.updateItem);

  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [totals, setTotals] = useState<ItemTimeTotals | null>(null);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const isActiveOnThisItem = activeEntry?.item_id === item.id;

  // ---- Live tick for the elapsed display when this item is active ----
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isActiveOnThisItem) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [isActiveOnThisItem]);

  // ---- Load entries + totals for this item ----
  useEffect(() => {
    let cancelled = false;
    setLoadingEntries(true);
    fetch(`/api/timing/entries?item_id=${encodeURIComponent(item.id)}&limit=100`)
      .then((r) => (r.ok ? (r.json() as Promise<EntriesResponse>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        setEntries(data.entries);
        setTotals(data.totals);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingEntries(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, refreshKey, activeEntry?.id, activeEntry?.ended_at]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const handleStart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await start(item.id, { itemTitle: item.title });
      refresh();
    } catch (e) {
      console.error("[timing] start failed", e);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stop();
      refresh();
    } catch (e) {
      console.error("[timing] stop failed", e);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить эту сессию?")) return;
    try {
      const res = await fetch(`/api/timing/entries/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      refresh();
    } catch (e) {
      console.error("[timing] delete entry failed", e);
    }
  };

  // For active rows — show live elapsed, otherwise (ended_at - started_at).
  const elapsedForRow = (entry: TimeEntry): number => {
    if (entry.ended_at) {
      return Math.max(
        0,
        Math.floor(
          (new Date(entry.ended_at).getTime() - new Date(entry.started_at).getTime()) / 1000,
        ),
      );
    }
    if (isActiveOnThisItem && activeEntry?.id === entry.id) return elapsedFn();
    return Math.max(
      0,
      Math.floor((Date.now() - new Date(entry.started_at).getTime()) / 1000),
    );
  };

  const selfSec = totals?.self_seconds ?? 0;
  const totalSec = totals?.total_seconds ?? 0;
  const subtasksSec = Math.max(0, totalSec - selfSec);

  const estimateMin = item.estimated_minutes ?? null;
  const estimateSec = estimateMin != null ? estimateMin * 60 : null;
  const overEstimate =
    estimateSec != null && totalSec > estimateSec
      ? totalSec - estimateSec
      : 0;
  const estimatePct =
    estimateSec && estimateSec > 0
      ? Math.min(200, Math.round((totalSec / estimateSec) * 100))
      : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className={cn("font-medium text-slate-500", layout === "panel" ? "text-xs" : "text-sm")}>
          Время работы
        </span>
      </div>

      {/* ---- Big Start/Stop button ---- */}
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        {isActiveOnThisItem ? (
          <Button
            variant="destructive"
            onClick={handleStop}
            disabled={busy}
            size="lg"
            className="min-w-[110px]"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Square />}
            Стоп
          </Button>
        ) : (
          <Button
            variant="default"
            onClick={handleStart}
            disabled={busy}
            size="lg"
            className="min-w-[110px]"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Play />}
            {activeEntry ? "Переключить" : "Запустить"}
          </Button>
        )}
        <div className="flex-1 min-w-0">
          {isActiveOnThisItem ? (
            <div className="font-mono tabular-nums text-2xl leading-none font-semibold text-emerald-600">
              {formatHMS(elapsedFn())}
            </div>
          ) : (
            <div className="text-xs text-slate-500">
              {activeEntry
                ? "Сейчас идёт другая задача — Запуск переключит таймер"
                : "Нет активного таймера"}
            </div>
          )}
        </div>
      </div>

      {/* ---- Totals + estimate ---- */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <Stat label="Своих" value={selfSec} />
        <Stat label="Подзадачи" value={subtasksSec} />
        <Stat label="Итого" value={totalSec} highlight />
      </div>

      <EstimateRow
        estimateMin={estimateMin}
        onChange={(min) => updateItem(item.id, { estimated_minutes: min })}
      />

      {estimatePct != null && (
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                estimatePct <= 100
                  ? "bg-emerald-500"
                  : estimatePct <= 200
                    ? "bg-amber-500"
                    : "bg-red-500",
              )}
              style={{ width: `${Math.min(100, estimatePct)}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-500">
            <span>{estimatePct}% от оценки</span>
            {overEstimate > 0 && (
              <span className="text-red-500">+{formatHM(Math.round(overEstimate / 60))}</span>
            )}
          </div>
        </div>
      )}

      {/* ---- Sessions list ---- */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">
            Сессии ({entries.length})
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setManualOpen(true)}
          >
            <Plus /> Добавить вручную
          </Button>
        </div>
        {loadingEntries ? (
          <div className="text-xs text-slate-400 py-2">Загрузка…</div>
        ) : entries.length === 0 ? (
          <div className="text-xs text-slate-400 py-2">Нет сессий</div>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                durationSec={elapsedForRow(entry)}
                isActive={activeEntry?.id === entry.id}
                onEdit={() => setEditingEntry(entry)}
                onDelete={() => handleDelete(entry.id)}
              />
            ))}
          </ul>
        )}
      </div>

      <ManualEntryDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        itemId={item.id}
        onCreated={refresh}
      />
      <EditEntryDialog
        entry={editingEntry}
        onClose={() => setEditingEntry(null)}
        onSaved={refresh}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-white px-2 py-1.5",
        highlight ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200",
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-mono tabular-nums text-sm font-medium">
        {value > 0 ? formatHM(Math.round(value / 60)) : "—"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function EstimateRow({
  estimateMin,
  onChange,
}: {
  estimateMin: number | null;
  onChange: (min: number | null) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(formatEstimateInput(estimateMin));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setDraft(formatEstimateInput(estimateMin));
  }, [estimateMin]);

  const save = () => {
    setEditing(false);
    const parsed = parseEstimateInput(draft);
    if (parsed === undefined) {
      setDraft(formatEstimateInput(estimateMin));
      return;
    }
    if (parsed === estimateMin) return;
    void onChange(parsed);
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-500">Оценка:</span>
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setDraft(formatEstimateInput(estimateMin));
              setEditing(false);
            }
          }}
          className="h-6 w-24 text-xs"
          placeholder="напр. 1ч 30м"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded px-1.5 py-0.5 hover:bg-slate-100 text-slate-700"
        >
          {estimateMin != null ? formatHM(estimateMin) : "не задана"}
          <Pencil className="ml-1 inline-block size-3 text-slate-400" />
        </button>
      )}
    </div>
  );
}

function formatEstimateInput(min: number | null): string {
  if (min == null) return "";
  return formatHM(min);
}

// Accepts: "90", "90m", "1h 30m", "1.5h", "1ч 30м", "" (clears).
function parseEstimateInput(raw: string): number | null | undefined {
  const s = raw.trim().toLowerCase();
  if (s === "") return null;
  // Pure number → minutes.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number.parseFloat(s);
    if (!isFinite(n) || n < 0) return undefined;
    return Math.round(n);
  }
  let total = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)\s*(h|ч|m|м|hours?|hr|min|mins|минут?)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const n = Number.parseFloat(m[1]);
    if (!isFinite(n) || n < 0) return undefined;
    const unit = m[2] ?? "m";
    if (/^h|ч|hour|hr/.test(unit)) total += n * 60;
    else total += n;
    matched = true;
  }
  if (!matched) return undefined;
  return Math.round(total);
}

// ---------------------------------------------------------------------------
function EntryRow({
  entry,
  durationSec,
  isActive,
  onEdit,
  onDelete,
}: {
  entry: TimeEntry;
  durationSec: number;
  isActive: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const started = new Date(entry.started_at);
  const ended = entry.ended_at ? new Date(entry.ended_at) : null;
  const fmt = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dayFmt = (d: Date) =>
    d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });

  return (
    <li className="flex items-center gap-2 px-2 py-1.5 text-xs">
      <span className="text-slate-500 tabular-nums shrink-0">
        {dayFmt(started)} {fmt(started)}–{ended ? fmt(ended) : "…"}
      </span>
      <span className="font-mono tabular-nums font-medium shrink-0">
        {formatHMS(durationSec)}
      </span>
      {isActive && (
        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 font-medium shrink-0">
          активна
        </span>
      )}
      {entry.source !== "manual" && (
        <span
          className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 shrink-0"
          title={entry.source}
        >
          {sourceLabel(entry.source)}
        </span>
      )}
      {entry.note && (
        <span className="text-slate-500 truncate flex-1" title={entry.note}>
          · {entry.note}
        </span>
      )}
      <div className="ml-auto flex items-center gap-0.5 shrink-0">
        {ended && (
          <Button variant="ghost" size="icon-xs" onClick={onEdit} title="Редактировать">
            <Pencil />
          </Button>
        )}
        {ended && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDelete}
            title="Удалить"
            className="text-red-500"
          >
            <Trash2 />
          </Button>
        )}
      </div>
    </li>
  );
}

function sourceLabel(s: TimeEntry["source"]): string {
  switch (s) {
    case "auto_stop":
      return "автостоп";
    case "idle_discard":
      return "idle";
    case "mutex_replace":
      return "переключение";
    case "manual_edit":
      return "ред.";
    case "pomodoro_complete":
      return "помодоро";
    default:
      return s;
  }
}
