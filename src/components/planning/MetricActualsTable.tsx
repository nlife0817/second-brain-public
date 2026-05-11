"use client";

// MetricActualsTable — таблица «План / Факт / Δ» по периодам.
// Колонка «Факт» editable только для metric.source='manual' (см. PLAN_PLANNING_REWORK P4).
// Для других источников (second_brain, grafana, product_analytics) — read-only.

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { markLocalMutation } from "@/lib/planning-realtime";
import type {
  PlanningMetric,
  PlanningMetricTarget,
  PlanningMetricTick,
  PlanningPeriod,
} from "@/types/planning";
import { formatPeriodFull, formatMetricValue } from "@/lib/planning-format";

interface Props {
  metric: PlanningMetric;
  periods: PlanningPeriod[];
  targets: PlanningMetricTarget[];
  ticks: PlanningMetricTick[];
  onChanged: () => void;
}

function ts(d: string): number { return new Date(d).getTime(); }

export function MetricActualsTable({ metric, periods, targets, ticks, onChanged }: Props) {
  const targetByPeriod = useMemo(
    () => new Map(targets.map((t) => [t.period_id, Number(t.target_value)])),
    [targets]
  );

  // Сумма тиков, попавших в [period.start_date, period.end_date].
  // Для cumulative-метрик «факт периода» = сумма ticks этого периода.
  // Для non-cumulative — LAST tick.
  const actualByPeriod = useMemo(() => {
    const out = new Map<string, number>();
    for (const p of periods) {
      const startTs = ts(p.start_date);
      const endTs = ts(p.end_date) + 86_399_000;
      const inRange = ticks.filter((tk) => {
        const m = ts(tk.measured_at);
        return m >= startTs && m <= endTs;
      });
      if (inRange.length === 0) continue;
      if (metric.is_cumulative) {
        out.set(p.id, inRange.reduce((s, tk) => s + Number(tk.value), 0));
      } else {
        const sorted = inRange.slice().sort((a, b) => a.measured_at.localeCompare(b.measured_at));
        out.set(p.id, Number(sorted[sorted.length - 1].value));
      }
    }
    return out;
  }, [periods, ticks, metric.is_cumulative]);

  const editable = metric.source === "manual";

  const [edit, setEdit] = useState<{ id: string; v: string } | null>(null);

  const save = async (periodId: string, value: number) => {
    markLocalMutation();
    const res = await fetch(`/api/planning/metrics/${metric.id}/actuals`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ period_id: periodId, value }] }),
    });
    if (!res.ok) { toast.error("Не удалось сохранить факт"); return; }
    onChanged();
  };

  const totalTarget = periods.reduce((s, p) => s + (targetByPeriod.get(p.id) ?? 0), 0);
  const totalActual = periods.reduce((s, p) => s + (actualByPeriod.get(p.id) ?? 0), 0);
  const totalDelta = totalActual - totalTarget;

  // Для non-cumulative — total бессмысленен, не показываем footer-агрегат.
  const showFooter = metric.is_cumulative;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
          <th className="px-2 py-1.5">Период</th>
          <th className="px-2 py-1.5 text-right">План</th>
          <th className="px-2 py-1.5 text-right">Факт</th>
          <th className="px-2 py-1.5 text-right">Δ</th>
        </tr>
      </thead>
      <tbody>
        {periods.map((p) => {
          const target = targetByPeriod.get(p.id) ?? 0;
          const actual = actualByPeriod.get(p.id);
          const hasActual = actual !== undefined;
          const delta = hasActual ? actual - target : null;
          const isPositive =
            metric.direction_value === "down" ? (delta !== null && delta <= 0) : (delta !== null && delta >= 0);
          const editing = edit?.id === p.id;
          return (
            <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/50">
              <td className="px-2 py-1.5 font-medium text-slate-700">{formatPeriodFull(p)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                {target > 0 ? formatMetricValue(target, metric.unit) : <span className="text-slate-300">—</span>}
              </td>
              <td className="px-2 py-1.5 text-right">
                {editing && editable ? (
                  <input
                    autoFocus
                    type="number"
                    value={edit!.v}
                    onChange={(e) => setEdit({ id: p.id, v: e.target.value })}
                    onBlur={() => { void save(p.id, Number(edit!.v)); setEdit(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { void save(p.id, Number(edit!.v)); setEdit(null); }
                      if (e.key === "Escape") setEdit(null);
                    }}
                    className="w-32 rounded-md border border-slate-300 px-2 py-1 text-right text-sm"
                  />
                ) : editable ? (
                  <button
                    onClick={() => setEdit({ id: p.id, v: hasActual ? String(actual) : "" })}
                    className="rounded-md px-2 py-1 tabular-nums hover:bg-slate-100"
                    title="Кликните, чтобы ввести/изменить факт"
                  >
                    {hasActual
                      ? formatMetricValue(actual, metric.unit)
                      : <span className="text-slate-400">— ввести</span>}
                  </button>
                ) : (
                  <span className="tabular-nums text-slate-700">
                    {hasActual ? formatMetricValue(actual, metric.unit) : <span className="text-slate-300">—</span>}
                  </span>
                )}
              </td>
              <td className={`px-2 py-1.5 text-right tabular-nums ${
                delta === null ? "text-slate-300"
                : isPositive ? "text-emerald-600"
                : "text-red-600"
              }`}>
                {delta === null
                  ? "—"
                  : `${delta > 0 ? "+" : ""}${formatMetricValue(delta, metric.unit)}`}
              </td>
            </tr>
          );
        })}
      </tbody>
      {showFooter && (
        <tfoot>
          <tr className="bg-slate-50">
            <td className="px-2 py-1.5 text-xs font-semibold text-slate-500">Сумма</td>
            <td className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums text-slate-700">
              {formatMetricValue(totalTarget, metric.unit)}
            </td>
            <td className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums text-slate-700">
              {formatMetricValue(totalActual, metric.unit)}
            </td>
            <td className={`px-2 py-1.5 text-right text-xs font-semibold tabular-nums ${
              totalDelta === 0 ? "text-slate-400"
              : (metric.direction_value === "down" ? totalDelta <= 0 : totalDelta >= 0) ? "text-emerald-600"
              : "text-red-600"
            }`}>
              {totalDelta > 0 ? "+" : ""}{formatMetricValue(totalDelta, metric.unit)}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
