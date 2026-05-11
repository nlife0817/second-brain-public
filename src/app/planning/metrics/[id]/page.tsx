"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Settings as SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { MetricChart } from "@/components/planning/MetricChart";
import { MetricActualsTable } from "@/components/planning/MetricActualsTable";
import { AutoDistributeDialog } from "@/components/planning/AutoDistributeDialog";
import { DeliveryMetricMatrix } from "@/components/planning/DeliveryMetricMatrix";
import { MetricSettingsPanel } from "@/components/planning/MetricSettingsPanel";
import { formatMetricValue } from "@/lib/planning-format";
import type { PlanningMetric, PlanningMetricTarget, PlanningMetricTick, PlanningPeriod } from "@/types/planning";

const METRIC_TYPE_LABEL: Record<PlanningMetric["type"], string> = {
  numeric: "Числовая",
  business: "Бизнес",
  delivery: "Выполнение",
};

const PERIOD_LABEL: Record<"quarter" | "month" | "week", string> = {
  quarter: "Кварталы",
  month: "Месяцы",
  week: "Недели",
};

export default function MetricPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [metric, setMetric] = useState<PlanningMetric | null>(null);
  const [targets, setTargets] = useState<PlanningMetricTarget[]>([]);
  const [ticks, setTicks] = useState<PlanningMetricTick[]>([]);
  const [periods, setPeriods] = useState<PlanningPeriod[]>([]);
  const [yearPeriod, setYearPeriod] = useState<PlanningPeriod | null>(null);
  const [periodType, setPeriodType] = useState<"quarter" | "month" | "week">("quarter");
  const [openDistribute, setOpenDistribute] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const ensureTriedRef = useRef(false);
  const year = new Date().getFullYear();

  const fetchAll = useCallback(async () => {
    const [m, ti] = await Promise.all([
      fetch(`/api/planning/metrics/${id}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/planning/metrics/${id}/ticks?limit=200`).then((r) => r.ok ? r.json() : []),
    ]);
    setMetric(m); setTicks(ti);
    if (m) {
      const dirParam = m.direction_id ?? "null";
      // P4: targets — с server-side агрегацией для выбранного horizon.
      const [t, pSel, pYear] = await Promise.all([
        fetch(`/api/planning/metrics/${id}/targets?period_type=${periodType}&year=${year}`).then((r) => r.ok ? r.json() : []),
        fetch(`/api/planning/periods?type=${periodType}&year=${year}&direction_id=${dirParam}`).then((r) => r.ok ? r.json() : []),
        fetch(`/api/planning/periods?type=year&year=${year}&direction_id=${dirParam}`).then((r) => r.ok ? r.json() : []),
      ]);
      setTargets(t);
      setPeriods(pSel);
      setYearPeriod(pYear[0] ?? null);
    }
  }, [id, periodType, year]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // Silent auto-ensure периодов (старые метрики без P0). UI-кнопка убрана.
  useEffect(() => {
    if (!metric || ensureTriedRef.current) return;
    if (periods.length > 0 || yearPeriod) return;
    if (metric.type === "delivery") return;
    ensureTriedRef.current = true;
    void (async () => {
      const res = await fetch("/api/planning/periods/init-year", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, direction_id: metric.direction_id }),
      });
      if (res.ok) await fetchAll();
    })();
  }, [metric, periods.length, yearPeriod, year, fetchAll]);

  const saveYearTarget = async (raw: string) => {
    if (!metric) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    // P4: годовая цель — в metric.annual_target, не в target-row.
    const res = await fetch(`/api/planning/metrics/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annual_target: value }),
    });
    if (!res.ok) { toast.error("Не удалось сохранить годовую цель"); return; }
    fetchAll();
  };

  if (!metric) return <div className="p-6 text-sm text-slate-500">Загрузка…</div>;

  // P4: годовая цель из колонки annual_target. Targets — теперь только week-level
  // (загружаются с агрегацией для quarter/month при чтении через ?period_type=).
  const yearTarget = Number(metric.annual_target ?? 0);
  const factSum = ticks.reduce((s, t) => s + Number(t.value), 0);
  const latestFact = ticks.length > 0
    ? Number([...ticks].sort((a, b) => b.measured_at.localeCompare(a.measured_at))[0].value)
    : (metric.baseline ?? 0);
  const factForKpi = metric.is_cumulative ? factSum : latestFact;
  const progressPct = yearTarget > 0 ? Math.round((factForKpi / yearTarget) * 100) : null;
  const gap = yearTarget - factForKpi;

  // Chart data: plan from targets + fact from ticks
  const chartData = (() => {
    const byDate = new Map<string, { date: string; plan?: number; fact?: number }>();
    for (const t of targets) {
      const p = periods.find((pp) => pp.id === t.period_id);
      if (!p) continue;
      const d = p.end_date;
      const existing = byDate.get(d) ?? { date: d };
      existing.plan = Number(t.target_value);
      byDate.set(d, existing);
    }
    for (const tk of ticks) {
      const d = tk.measured_at.slice(0, 10);
      const existing = byDate.get(d) ?? { date: d };
      existing.fact = Number(tk.value);
      byDate.set(d, existing);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  })();

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-4">
        <Link href="/planning/columns" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          <ChevronLeft className="size-3.5" />
          К колонкам
        </Link>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{metric.title}</h1>
            <p className="text-sm text-slate-500">
              {METRIC_TYPE_LABEL[metric.type]}
              {metric.unit ? ` · ${metric.unit}` : ""}
              {metric.direction_value === "up" ? " · ↑ рост = хорошо"
                : metric.direction_value === "down" ? " · ↓ снижение = хорошо"
                : ""}
            </p>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors ${
              showSettings ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <SettingsIcon className="size-3.5" />
            Настройки
          </button>
        </div>
      </div>

      {/* Settings panel (collapsible) */}
      {showSettings && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <h2 className="mb-3 text-sm font-semibold">Параметры метрики</h2>
          <MetricSettingsPanel metric={metric} onChanged={fetchAll} />
        </div>
      )}

      {/* Periods are auto-ensured silently on mount; init-year UI removed (PLAN_PLANNING_REWORK P0). */}
          {/* Year target — primary KPI входная точка */}
          {yearPeriod && (
            <div className="mb-4 rounded-xl border border-slate-200 p-4">
              <div className="flex items-end justify-between gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-600">
                    Годовая цель {year}
                  </label>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Задайте однажды, дальше распределите по {PERIOD_LABEL[periodType].toLowerCase()} одной кнопкой
                  </p>
                  <YearTargetInput
                    key={`${yearPeriod.id}:${yearTarget}`}
                    initial={yearTarget ? String(yearTarget) : ""}
                    onSave={saveYearTarget}
                  />
                  {yearTarget > 0 && (
                    <span className="ml-2 text-xs text-slate-500">
                      ≈ {formatMetricValue(yearTarget, metric.unit)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setOpenDistribute(true)}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  title="Разнести годовую цель по кварталам/месяцам/неделям одной операцией"
                >
                  ↻ Распределить по {PERIOD_LABEL[periodType].toLowerCase()}
                </button>
              </div>
            </div>
          )}

          {/* Bento grid: chart + key numbers */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 rounded-xl border border-slate-200 p-4">
              <h2 className="mb-2 text-sm font-semibold">
                {metric.type === "delivery" ? "Матрица инициатива × дедлайн" : "План vs Факт"}
              </h2>
              {metric.type === "delivery" ? (
                <DeliveryMetricMatrix metricId={metric.id} periods={periods} />
              ) : chartData.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center text-center">
                  <p className="text-sm text-slate-500">Пока нет ни плана, ни фактов</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Задайте годовую цель → нажмите «Распределить»<br />
                    Факты появятся автоматически из {metric.source ?? "источника"}
                  </p>
                </div>
              ) : (
                <MetricChart data={chartData} />
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h2 className="text-sm font-semibold">Ключевые цифры</h2>
              <KV label="Цель года" value={formatMetricValue(yearTarget, metric.unit)} />
              <KV label="Факт" value={formatMetricValue(factForKpi, metric.unit)} />
              {progressPct !== null && (
                <KV
                  label="Прогресс"
                  value={`${progressPct}%`}
                  tone={progressPct >= 90 ? "good" : progressPct >= 50 ? "warn" : "bad"}
                />
              )}
              <KV
                label="Gap"
                value={formatMetricValue(gap, metric.unit)}
                tone={gap > 0 ? "warn" : "good"}
              />
              {metric.baseline != null && (
                <KV label="Baseline" value={formatMetricValue(metric.baseline, metric.unit)} muted />
              )}
            </div>
          </div>

          {/* Targets by horizon */}
          <div className="mt-4 rounded-xl border border-slate-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Цели по горизонтам</h2>
                <div role="tablist" className="flex items-center gap-1">
                  {(["quarter", "month", "week"] as const).map((pt) => (
                    <button
                      key={pt}
                      role="tab"
                      aria-selected={periodType === pt}
                      onClick={() => setPeriodType(pt)}
                      className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        periodType === pt ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"
                      }`}
                    >
                      {PERIOD_LABEL[pt]}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setOpenDistribute(true)}
                disabled={periods.length === 0}
                className="rounded-md border border-blue-500 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-30"
              >
                ↻ Распределить
              </button>
            </div>
            {periods.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500">
                Подгружаем периоды…
              </div>
            ) : (
              <MetricActualsTable metric={metric} periods={periods} targets={targets} ticks={ticks} onChanged={fetchAll} />
            )}
          </div>

      <AutoDistributeDialog
        open={openDistribute}
        onClose={() => setOpenDistribute(false)}
        metricId={metric.id}
        periodCount={periods.length}
        periodType={periodType}
        year={year}
        initialYearTarget={yearTarget}
        unit={metric.unit}
        periods={periods}
        existingTargets={targets}
        onApplied={fetchAll}
      />
    </div>
  );
}

function YearTargetInput({ initial, onSave }: { initial: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <input
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onSave(draft)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      placeholder="например, 20000000"
      className="mt-1 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm"
    />
  );
}

function KV({ label, value, tone, muted }: { label: string; value: string | number; tone?: "good" | "warn" | "bad"; muted?: boolean }) {
  const valueCls =
    tone === "good" ? "text-emerald-600" :
    tone === "warn" ? "text-amber-600" :
    tone === "bad" ? "text-red-600" :
    muted ? "text-slate-400" : "text-slate-800";
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold tabular-nums ${valueCls}`}>{value}</span>
    </div>
  );
}
