"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { PlanningMetricTarget, PlanningPeriod, PlanningMetric } from "@/types/planning";
import { formatPeriodFull, formatMetricValue } from "@/lib/planning-format";

interface Props {
  metric: PlanningMetric;
  periods: PlanningPeriod[];
  targets: PlanningMetricTarget[];
  onChanged: () => void;
}

export function MetricTargetsTable({ metric, periods, targets, onChanged }: Props) {
  const byPeriod = new Map(targets.map((t) => [t.period_id, t]));
  const [edit, setEdit] = useState<{ id: string; v: string } | null>(null);

  const save = async (periodId: string, value: number) => {
    const res = await fetch(`/api/planning/metrics/${metric.id}/targets`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ metric_id: metric.id, period_id: periodId, target_value: value }] }),
    });
    if (!res.ok) { toast.error("Не удалось сохранить"); return; }
    onChanged();
  };

  const total = periods.reduce((s, p) => s + Number(byPeriod.get(p.id)?.target_value ?? 0), 0);

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-2 py-1.5">Период</th>
            <th className="px-2 py-1.5 text-right">Цель</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => {
            const t = byPeriod.get(p.id);
            const id = p.id;
            const editing = edit?.id === id;
            return (
              <tr key={id} className="border-b border-slate-100 hover:bg-slate-50/50">
                <td className="px-2 py-1.5 font-medium text-slate-700">{formatPeriodFull(p)}</td>
                <td className="px-2 py-1.5 text-right">
                  {editing ? (
                    <input
                      autoFocus
                      type="number"
                      value={edit!.v}
                      onChange={(e) => setEdit({ id, v: e.target.value })}
                      onBlur={() => { save(id, Number(edit!.v)); setEdit(null); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { save(id, Number(edit!.v)); setEdit(null); }
                        if (e.key === "Escape") setEdit(null);
                      }}
                      className="w-32 rounded-md border border-slate-300 px-2 py-1 text-right text-sm"
                    />
                  ) : (
                    <button
                      onClick={() => setEdit({ id, v: t ? String(t.target_value) : "" })}
                      className="rounded-md px-2 py-1 tabular-nums hover:bg-slate-100"
                      title="Кликните, чтобы изменить"
                    >
                      {t ? formatMetricValue(Number(t.target_value), metric.unit) : <span className="text-slate-400">— добавить</span>}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50">
            <td className="px-2 py-1.5 text-xs font-semibold text-slate-500">
              Сумма
            </td>
            <td className="px-2 py-1.5 text-right text-sm font-semibold tabular-nums text-slate-700">
              {formatMetricValue(total, metric.unit)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
