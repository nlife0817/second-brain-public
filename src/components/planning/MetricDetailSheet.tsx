"use client";

// Right-side metric detail/edit drawer used from the Columns view.
// Concept §20.1.1 — inline editing; §20.1.4 — empty states with CTA.
//
// What's inside:
//   1. Title (inline edit) + type chip with description.
//   2. Quick settings (MetricSettingsPanel, type-aware fields).
//   3. Year-target block (or "init year" CTA if no periods exist yet).
//   4. Distribute action + horizons (quarter / month / week) with editable table.
//   5. Link to full metric page for graphs / sources block.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, ExternalLink, Repeat } from "lucide-react";
import { toast } from "sonner";
import { usePlanningStore } from "@/lib/planning-store";
import { MetricSettingsPanel } from "./MetricSettingsPanel";
import { MetricActualsTable } from "./MetricActualsTable";
import { AutoDistributeDialog } from "./AutoDistributeDialog";
import { DeliveryMetricMatrix } from "./DeliveryMetricMatrix";
import { InlineTextField } from "./InlineTextField";
import { formatMetricValue, formatPeriodFull } from "@/lib/planning-format";
import type {
  PlanningMetric,
  PlanningMetricTarget,
  PlanningMetricTick,
  PlanningPeriod,
} from "@/types/planning";

interface Props {
  metricId: string | null;
  onClose: () => void;
}

const TYPE_LABEL: Record<PlanningMetric["type"], string> = {
  numeric:  "Числовая",
  business: "Бизнес",
  delivery: "Выполнение",
};

const TYPE_HINT: Record<PlanningMetric["type"], string> = {
  numeric:  "Технические метрики: latency, throughput, NPS, конверсия. Tick из источника, цели по горизонтам.",
  business: "Деньги и подписания: выручка, новые клиенты. Факт капает из сделок/платежей, всегда накопительно.",
  delivery: "Именованный список инициатив с дедлайном. Прогресс по матрице «инициатива × попала в дедлайн».",
};

const TYPE_TONE: Record<PlanningMetric["type"], string> = {
  numeric:  "bg-sky-50 text-sky-700 border-sky-200",
  business: "bg-emerald-50 text-emerald-700 border-emerald-200",
  delivery: "bg-violet-50 text-violet-700 border-violet-200",
};

const HORIZONS = [
  { value: "quarter" as const, label: "Кварталы", hint: "4 шт" },
  { value: "month"   as const, label: "Месяцы",   hint: "12 шт" },
  { value: "week"    as const, label: "Недели",   hint: "~52 шт" },
];

export function MetricDetailSheet({ metricId, onClose }: Props) {
  if (!metricId) return null;
  return <MetricDetailSheetInner metricId={metricId} onClose={onClose} />;
}

function MetricDetailSheetInner({ metricId, onClose }: { metricId: string; onClose: () => void }) {
  const metrics = usePlanningStore((s) => s.metrics);
  const refreshAll = usePlanningStore((s) => s.fetchAll);
  const autoOpenSettings = usePlanningStore((s) => s.detailMetricAutoOpenSettings);
  const updateMetric = usePlanningStore((s) => s.updateMetric);

  const metric = metrics.find((m) => m.id === metricId) ?? null;
  const year = new Date().getFullYear();

  const [targets, setTargets] = useState<PlanningMetricTarget[]>([]);
  const [ticks, setTicks] = useState<PlanningMetricTick[]>([]);
  const [periods, setPeriods] = useState<PlanningPeriod[]>([]);
  const [yearPeriod, setYearPeriod] = useState<PlanningPeriod | null>(null);
  const [horizon, setHorizon] = useState<"quarter" | "month" | "week">("quarter");
  const [showSettings, setShowSettings] = useState<boolean>(autoOpenSettings);
  const [openDistribute, setOpenDistribute] = useState(false);
  // P4.6: «Перераспределить недобор» — открывает тот же диалог, но с
  // skip_weeks_before=today + yearTarget = annual_target - actual_ytd.
  const [openRedistribute, setOpenRedistribute] = useState(false);
  const ensureTriedRef = useRef(false);

  const load = useCallback(async () => {
    if (!metric) return;
    const dirParam = metric.direction_id ?? "null";
    // P4: targets — с server-side агрегацией; ticks — для колонки «Факт».
    const [t, tk, pSel, pYear] = await Promise.all([
      fetch(`/api/planning/metrics/${metric.id}/targets?period_type=${horizon}&year=${year}`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/planning/metrics/${metric.id}/ticks?limit=500`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/planning/periods?type=${horizon}&year=${year}&direction_id=${dirParam}`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/planning/periods?type=year&year=${year}&direction_id=${dirParam}`).then((r) => r.ok ? r.json() : []),
    ]);
    setTargets(t);
    setTicks(tk);
    setPeriods(pSel);
    setYearPeriod(pYear[0] ?? null);
  }, [metric, horizon, year]);

  useEffect(() => { void load(); }, [load]);

  // Silent auto-ensure: если у метрики ещё нет периодов (старые данные до P0),
  // молча инициализируем год — один раз на drawer. UI-кнопка убрана.
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
      if (res.ok) {
        await load();
        await refreshAll();
      }
    })();
  }, [metric, periods.length, yearPeriod, year, load, refreshAll]);

  if (!metric) return null;

  // P4: годовая цель — input, хранится в metric.annual_target, не как target-row.
  const yearTarget = Number(metric.annual_target ?? 0);
  const isDelivery = metric.type === "delivery";

  const saveYearTarget = async (raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    await updateMetric(metric.id, { annual_target: value });
  };

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-label="Метрика — детали">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="flex w-[480px] shrink-0 flex-col overflow-y-auto bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-slate-200 p-4">
          <div className="min-w-0 flex-1">
            <InlineTextField
              value={metric.title}
              onSave={(t) => updateMetric(metric.id, { title: t })}
              className="text-base font-semibold"
            />
            <div className="mt-1 flex items-center gap-1.5">
              <span
                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${TYPE_TONE[metric.type]}`}
                title={TYPE_HINT[metric.type]}
              >
                {TYPE_LABEL[metric.type]}
              </span>
              {metric.unit && <span className="text-[11px] text-slate-500">· {metric.unit}</span>}
              <Link
                href={`/planning/metrics/${metric.id}`}
                className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-blue-600 hover:bg-blue-50"
                title="Открыть полную страницу метрики"
              >
                Полная страница
                <ExternalLink className="size-3" />
              </Link>
            </div>
            <p className="mt-1 text-[11px] leading-tight text-slate-500">{TYPE_HINT[metric.type]}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Закрыть"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Settings block */}
        <details
          open={showSettings}
          onToggle={(e) => setShowSettings((e.target as HTMLDetailsElement).open)}
          className="border-b border-slate-200 p-4"
        >
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
            Параметры метрики
          </summary>
          <div className="mt-3">
            <MetricSettingsPanel metric={metric} onChanged={refreshAll} />
          </div>
        </details>

        {/* Year target + distribute (only for numeric / business). Periods are auto-ensured silently on mount. */}
        {!isDelivery && yearPeriod && (
          <div className="border-b border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Годовая цель {year}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Введите один раз — дальше распределите по горизонтам одной кнопкой
            </p>
            <div className="mt-2 flex items-center gap-2">
              <YearTargetInput
                key={`${yearPeriod.id}:${yearTarget}`}
                initial={yearTarget ? String(yearTarget) : ""}
                onSave={saveYearTarget}
              />
              <button
                onClick={() => setOpenDistribute(true)}
                disabled={periods.length === 0 || yearTarget <= 0}
                className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-30"
                title="Разнести годовую цель по всем 52 неделям"
              >
                <Repeat className="size-3.5" />
                Распределить
              </button>
              <button
                onClick={() => setOpenRedistribute(true)}
                disabled={periods.length === 0 || yearTarget <= 0}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-30"
                title="Разнести остаток годовой цели на оставшиеся недели (без автоматического catch-up по концепту E)"
              >
                <Repeat className="size-3.5" />
                Перераспределить недобор
              </button>
            </div>
            {yearTarget > 0 && (
              <p className="mt-1 text-[11px] text-slate-500">
                ≈ {formatMetricValue(yearTarget, metric.unit)}
              </p>
            )}
          </div>
        )}

        {/* Horizon picker — card style (per user feedback: no more dry tabs) */}
        {!isDelivery && (
          <div className="border-b border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Горизонт</p>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {HORIZONS.map((h) => (
                <button
                  key={h.value}
                  onClick={() => setHorizon(h.value)}
                  className={`flex flex-col rounded-md border px-2 py-1.5 text-left transition-colors ${
                    horizon === h.value
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="text-xs font-medium">{h.label}</span>
                  <span className="text-[10px] text-slate-500">{h.hint}</span>
                </button>
              ))}
            </div>

            <div className="mt-3">
              {periods.length === 0 ? (
                <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Подгружаем периоды…
                </p>
              ) : (
                <MetricActualsTable
                  metric={metric}
                  periods={periods}
                  targets={targets}
                  ticks={ticks}
                  onChanged={load}
                />
              )}
            </div>
          </div>
        )}

        {/* Delivery: matrix */}
        {isDelivery && (
          <div className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Матрица инициатива × дедлайн
            </p>
            <div className="mt-2">
              <DeliveryMetricMatrix metricId={metric.id} periods={periods} />
            </div>
          </div>
        )}

        {/* Business: payment-source hint */}
        {metric.type === "business" && yearPeriod && (
          <div className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Источник факта</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Факт автоматически считается из подтверждённых платежей сделок
              {metric.source === "manual" ? " (источник: ручной ввод — добавьте tick'и вручную)" : " (источник: Second Brain)"}.
              Подробности — на полной странице метрики.
            </p>
          </div>
        )}

        {yearPeriod && !isDelivery && (
          <div className="p-4 text-[11px] text-slate-400">
            Текущий годовой период: {formatPeriodFull(yearPeriod)}
          </div>
        )}

        <AutoDistributeDialog
          open={openDistribute}
          onClose={() => setOpenDistribute(false)}
          metricId={metric.id}
          periodCount={periods.length}
          periodType={horizon}
          year={year}
          initialYearTarget={yearTarget}
          unit={metric.unit}
          periods={periods}
          existingTargets={targets}
          onApplied={() => { void load(); }}
        />
        {/* P4.6: «Перераспределить недобор» — тот же диалог, но с
            skip_weeks_before=today; initialYearTarget = annual − actual_ytd. */}
        <AutoDistributeDialog
          open={openRedistribute}
          onClose={() => setOpenRedistribute(false)}
          metricId={metric.id}
          periodCount={periods.length}
          periodType={horizon}
          year={year}
          initialYearTarget={Math.max(0, yearTarget - ticks.reduce((s, t) => s + Number(t.value), 0))}
          unit={metric.unit}
          periods={periods}
          existingTargets={targets}
          onApplied={() => { void load(); }}
          skipWeeksBefore={new Date().toISOString().slice(0, 10)}
          title="Перераспределить недобор"
          subtitle={
            <>
              Остаток годовой цели (план минус факт YTD) раскладывается по оставшимся неделям года
              выбранной кривой. Предыдущие недели не трогаются. Если кривая «Ручной» — заполните вручную.
            </>
          }
        />
      </div>
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
      className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums"
    />
  );
}
