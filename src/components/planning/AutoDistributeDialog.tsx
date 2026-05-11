"use client";

import { useState, useMemo, useEffect } from "react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { distributeTarget } from "@/lib/planning-distribute";
import { toast } from "sonner";
import { formatMetricValue, formatPeriodFull } from "@/lib/planning-format";
import type { DistributeCurve, PlanningPeriod, PlanningMetricTarget } from "@/types/planning";

interface Props {
  open: boolean;
  onClose: () => void;
  metricId: string;
  periodCount: number;
  periodType: "quarter" | "month" | "week";
  year: number;
  initialYearTarget?: number;
  unit?: string | null;
  /** Periods being distributed over, sorted in chronological order. Required for editable preview table. */
  periods: PlanningPeriod[];
  /** Existing targets for these periods — used as the initial values when curve = "custom". */
  existingTargets: PlanningMetricTarget[];
  onApplied: () => void;
}

// Wrapper remounts Inner on open to reset internal draft state without useEffect on Inner.
export function AutoDistributeDialog(props: Props) {
  if (!props.open) return null;
  return <AutoDistributeDialogInner key={`${props.initialYearTarget ?? 0}-${props.periodType}-${props.periods.length}`} {...props} />;
}

const PERIOD_LABEL: Record<"quarter" | "month" | "week", string> = {
  quarter: "квартал",
  month:   "месяц",
  week:    "неделю",
};

const CURVES: Array<{ value: DistributeCurve; label: string; hint: string }> = [
  { value: "linear",       label: "Линейная",     hint: "Равномерно по всем периодам" },
  { value: "s_curve",      label: "S-кривая",     hint: "Медленный старт, ускорение, плато (типично для B2B SaaS)" },
  { value: "front_loaded", label: "Front-loaded", hint: "Большая часть в начале (для падающих метрик)" },
  { value: "back_loaded",  label: "Back-loaded",  hint: "Большая часть в конце" },
  { value: "history",      label: "По истории",   hint: "Повторить распределение прошлого года ± дельта" },
  { value: "custom",       label: "Ручной",       hint: "Заполнить значения в таблице вручную" },
];

function AutoDistributeDialogInner({
  onClose, metricId, periodCount, periodType, year, initialYearTarget, unit, periods, existingTargets, onApplied,
}: Omit<Props, "open">) {
  const [curve, setCurve] = useState<DistributeCurve>("linear");
  const [yearTarget, setYearTarget] = useState<number>(initialYearTarget ?? 0);
  /** Working copy of per-period values. Recomputed when curve / yearTarget / periods change. */
  const [draft, setDraft] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  // Recompute draft whenever curve / yearTarget changes — but only for non-custom curves.
  // "custom" preserves whatever the user has typed; on first switch into custom we seed it
  // with either existing targets or the current draft (= last computed curve).
  useEffect(() => {
    if (curve === "custom") {
      // Seed once when switching to custom: prefer existing targets, fall back to current draft.
      const byPeriod = new Map(existingTargets.map((t) => [t.period_id, Number(t.target_value)]));
      const seeded = periods.map((p, i) => byPeriod.get(p.id) ?? draft[i] ?? 0);
      setDraft(seeded);
      return;
    }
    const computed = distributeTarget(curve, yearTarget || 0, periodCount);
    setDraft(computed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curve, yearTarget, periodCount]);

  const draftSum = useMemo(() => draft.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0), [draft]);
  const sumMismatch = yearTarget > 0 && Math.abs(draftSum - yearTarget) / yearTarget > 0.01;

  const previewSeries = draft.map((v, i) => ({ i, v }));

  const apply = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // For non-custom curves we let the server recompute (matches what it logged in changelog);
      // for custom curves we explicitly PATCH /targets with the edited per-period values.
      if (curve === "custom") {
        if (periods.length !== draft.length) {
          toast.error("Кол-во периодов изменилось — переоткройте диалог");
          return;
        }
        const items = periods.map((p, i) => ({
          metric_id: metricId,
          period_id: p.id,
          target_value: draft[i],
        }));
        const res = await fetch(`/api/planning/metrics/${metricId}/targets`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        if (!res.ok) {
          toast.error("Не удалось сохранить ручные значения");
          return;
        }
      } else {
        const res = await fetch(`/api/planning/metrics/${metricId}/targets/distribute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ curve, year_target: yearTarget, period_type: periodType, year }),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          const code = errJson?.error;
          const msg =
            code === "no history data for previous year"
              ? "Нет данных за прошлый год — выберите другую кривую"
              : code === "no periods to distribute over"
                ? "Нет периодов — сначала инициализируйте год"
                : `Не удалось распределить${code ? ` (${code})` : ""}`;
          toast.error(msg);
          return;
        }
      }
      toast.success(`${periodCount} ячеек обновлено`);
      onApplied();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-[760px] flex-col rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 border-b border-slate-200 p-5">
          <h2 className="text-lg font-semibold">Распределить цель по {PERIOD_LABEL[periodType]}ам</h2>
          <p className="mt-1 text-xs text-slate-500">
            {periodCount} {PERIOD_LABEL[periodType]}(а/ев) будут обновлены одной операцией.
            После применения каждую ячейку можно поправить inline.
          </p>
        </div>

        <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto p-5">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Годовая цель {year}</span>
            <input
              type="number"
              autoFocus
              value={yearTarget || ""}
              onChange={(e) => setYearTarget(Number(e.target.value))}
              placeholder="например, 20000000"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums"
              disabled={curve === "custom"}
            />
            {yearTarget > 0 && (
              <span className="mt-0.5 block text-[10px] text-slate-400">
                ≈ {formatMetricValue(yearTarget, unit)}
              </span>
            )}
          </label>

          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Кривая распределения</p>
            <div className="grid grid-cols-3 gap-1.5">
              {CURVES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCurve(c.value)}
                  title={c.hint}
                  className={`rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                    curve === c.value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <div className="font-medium">{c.label}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500 line-clamp-2">{c.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Превью</p>
            <div className="h-28 rounded-md border border-slate-200 bg-slate-50 p-2">
              {draftSum > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={previewSeries}>
                    <XAxis dataKey="i" hide />
                    <YAxis hide />
                    <Line type="monotone" dataKey="v" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="flex h-full items-center justify-center text-xs text-slate-400">
                  Введите годовую цель или переключитесь в «Ручной»
                </p>
              )}
            </div>
          </div>

          {/* Editable table — concept §20.2.6 spreadsheet bulk-edit */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-slate-600">
                Значения по {PERIOD_LABEL[periodType]}ам {curve === "custom" ? "(вводите вручную)" : "(можно править)"}
              </p>
              <span className={`text-[11px] tabular-nums ${sumMismatch ? "text-amber-600" : "text-slate-500"}`}>
                Σ = {formatMetricValue(draftSum, unit)}
                {sumMismatch && ` (≠ ${formatMetricValue(yearTarget, unit)})`}
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-1.5">Период</th>
                    <th className="px-3 py-1.5 text-right">Значение</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p, i) => (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="px-3 py-1 text-xs text-slate-700">{formatPeriodFull(p)}</td>
                      <td className="px-3 py-1 text-right">
                        <input
                          type="number"
                          value={Number.isFinite(draft[i]) ? Math.round(draft[i]) : ""}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setDraft((cur) => {
                              const next = cur.slice();
                              next[i] = Number.isFinite(v) ? v : 0;
                              return next;
                            });
                            // Editing a single cell while a non-custom curve was selected
                            // turns intent into "custom" — otherwise the next useEffect
                            // recomputation would erase the manual edit.
                            if (curve !== "custom") setCurve("custom");
                          }}
                          className="w-32 rounded-md border border-slate-200 px-2 py-0.5 text-right text-xs tabular-nums"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200 p-4 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400">
            {curve === "custom"
              ? "Ручные значения сохранятся как есть"
              : "При применении server пересчитает по кривой; ручные правки выше — превью"}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              Отмена
            </button>
            <button
              onClick={apply}
              disabled={saving || (curve !== "custom" && !yearTarget) || (curve === "custom" && draftSum <= 0)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Применяем…" : "Применить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
