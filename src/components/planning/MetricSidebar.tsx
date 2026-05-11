"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Target as TargetIcon, Lightbulb, Filter } from "lucide-react";
import type {
  PlanningMetric,
  PlanningInitiative,
  PlanningInitiativeMetricLink,
  PlanningPeriod,
} from "@/types/planning";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatMetricValue } from "@/lib/planning-format";
import { INITIATIVE_STATUS_LABEL, SEMANTIC_CLASS, initiativeStatusTone } from "@/lib/planning-colors";
import { usePlanningStore } from "@/lib/planning-store";

const STORAGE_KEY = "planning:this-week:metricFilter";

interface MetricActual {
  ticks: Array<{ id: string; value: number; measured_at: string; source: string | null }>;
  aggregated: number | null;
}

interface Props {
  period: PlanningPeriod;
  directionId: string | null;
  metrics: PlanningMetric[];
  initiatives: PlanningInitiative[];
  initiativeMetricLinks: PlanningInitiativeMetricLink[];
  targetsByMetric: Record<string, number>;
  metricActuals: Record<string, MetricActual>;
  /** Перезагрузить страничные данные после ввода факта. */
  onActualSaved: () => void;
}

function loadFilter(directionId: string | null): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    return parsed?.[directionId ?? "_all"] ?? null;
  } catch { return null; }
}

function saveFilter(directionId: string | null, ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    obj[directionId ?? "_all"] = ids;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}

export function MetricSidebar({
  period, directionId, metrics, initiatives, initiativeMetricLinks,
  targetsByMetric, metricActuals, onActualSaved,
}: Props) {
  // Сохранённый набор «какие метрики показывать». null = все по умолчанию.
  const [shownIds, setShownIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    const stored = loadFilter(directionId);
    setShownIds(stored ? new Set(stored) : null);
  }, [directionId]);

  const allIds = useMemo(() => metrics.map((m) => m.id), [metrics]);
  const visible = useMemo(() => {
    if (!shownIds) return metrics;
    return metrics.filter((m) => shownIds.has(m.id));
  }, [metrics, shownIds]);

  const toggleVisible = (id: string) => {
    setShownIds((prev) => {
      const next = new Set(prev ?? allIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const arr = Array.from(next);
      saveFilter(directionId, arr);
      return next;
    });
  };

  const resetFilter = () => {
    setShownIds(null);
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const obj = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
        delete obj[directionId ?? "_all"];
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      } catch { /* ignore */ }
    }
  };

  // initiative_id -> set<metric_id>
  const initMetrics = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const l of initiativeMetricLinks) {
      const s = map.get(l.initiative_id) ?? new Set<string>();
      s.add(l.metric_id);
      map.set(l.initiative_id, s);
    }
    return map;
  }, [initiativeMetricLinks]);

  // metric_id -> initiatives, привязанные к ней
  const metricInitiatives = useMemo(() => {
    const map = new Map<string, PlanningInitiative[]>();
    for (const i of initiatives) {
      const linkedMetrics = initMetrics.get(i.id);
      if (!linkedMetrics) continue;
      for (const mId of linkedMetrics) {
        const arr = map.get(mId) ?? [];
        arr.push(i);
        map.set(mId, arr);
      }
    }
    return map;
  }, [initiatives, initMetrics]);

  return (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden border-l border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <TargetIcon className="size-3" />
          Метрики
        </h3>
        <Popover>
          <PopoverTrigger
            render={(p) => (
              <button {...p} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50">
                <Filter className="size-3" />
                {shownIds ? `${visible.length}/${metrics.length}` : "все"}
                <ChevronDown className="size-3" />
              </button>
            )}
          />
          <PopoverContent align="end" sideOffset={6} className="w-64 p-2">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Показывать</p>
            <div className="max-h-64 overflow-y-auto">
              {metrics.length === 0 && (
                <p className="px-1 text-xs text-slate-400">Нет метрик</p>
              )}
              {metrics.map((m) => {
                const on = shownIds ? shownIds.has(m.id) : true;
                return (
                  <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-slate-100">
                    <input type="checkbox" checked={on} onChange={() => toggleVisible(m.id)} />
                    <span className="line-clamp-1">{m.title}</span>
                  </label>
                );
              })}
            </div>
            {shownIds && (
              <button
                onClick={resetFilter}
                className="mt-2 w-full rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
              >
                Показать все
              </button>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {visible.length === 0 ? (
          <p className="rounded-md bg-white px-2 py-1.5 text-xs text-slate-400">Метрик нет</p>
        ) : visible.map((m) => (
          <MetricCard
            key={m.id}
            metric={m}
            target={targetsByMetric[m.id]}
            actual={metricActuals[m.id]}
            initiatives={metricInitiatives.get(m.id) ?? []}
            period={period}
            onActualSaved={onActualSaved}
          />
        ))}
      </div>
    </aside>
  );
}

function MetricCard({
  metric, target, actual, initiatives, period, onActualSaved,
}: {
  metric: PlanningMetric;
  target: number | undefined;
  actual: MetricActual | undefined;
  initiatives: PlanningInitiative[];
  period: PlanningPeriod;
  onActualSaved: () => void;
}) {
  const openInitiativeDetail = usePlanningStore((s) => s.openInitiativeDetail);
  const [actualInput, setActualInput] = useState<string>(
    actual?.aggregated != null ? String(actual.aggregated) : "",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setActualInput(actual?.aggregated != null ? String(actual.aggregated) : "");
  }, [actual?.aggregated]);

  const onSaveActual = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      toast.error("Не число");
      return;
    }
    if (actual?.aggregated === value) return;
    setSaving(true);
    try {
      const measured_at = period.end_date;
      // Для не-cumulative последний tick за неделю «побеждает» в агрегате,
      // поэтому новый POST просто перепишет факт. Для cumulative — суммируется.
      const res = await fetch(`/api/planning/metrics/${metric.id}/ticks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value, measured_at, source: "manual" }),
      });
      if (!res.ok) {
        toast.error("Не удалось сохранить факт");
      } else {
        onActualSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  const variance =
    target !== undefined && actual?.aggregated != null
      ? actual.aggregated - target
      : null;
  const onTrack = variance === null
    ? null
    : metric.direction_value === "down"
      ? variance <= 0
      : variance >= 0;

  return (
    <div className="mb-2 rounded-md border border-slate-200 bg-white p-2 text-xs">
      <p className="font-medium text-slate-800">{metric.title}</p>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-slate-500">
          Цель: <span className="font-medium text-slate-700">{target !== undefined ? formatMetricValue(target, metric.unit) : "—"}</span>
        </span>
        {onTrack !== null && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${onTrack ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
            {onTrack ? "в плане" : "отстаёт"}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-[10px] text-slate-500">Факт:</span>
        <input
          type="number"
          step="any"
          value={actualInput}
          onChange={(e) => setActualInput(e.target.value)}
          onBlur={(e) => onSaveActual(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          disabled={saving}
          placeholder="—"
          className="w-24 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs tabular-nums"
        />
        <span className="text-[10px] text-slate-400">{metric.unit ?? ""}</span>
      </div>

      {initiatives.length > 0 && (
        <div className="mt-1.5 border-t border-slate-100 pt-1.5">
          <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <Lightbulb className="size-2.5" /> Инициативы
          </p>
          <ul className="flex flex-col gap-0.5">
            {initiatives.map((i) => {
              const tone = initiativeStatusTone(i.status);
              const dot = SEMANTIC_CLASS[tone].dot;
              return (
                <li key={`${metric.id}:${i.id}`}>
                  <button
                    type="button"
                    onClick={() => openInitiativeDetail(i.id)}
                    className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-slate-50"
                  >
                    <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
                    <span className="flex-1 line-clamp-1">{i.title}</span>
                    <span className="text-[9px] text-slate-400">{INITIATIVE_STATUS_LABEL[i.status]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
