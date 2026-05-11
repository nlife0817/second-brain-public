"use client";

import { useState, useMemo } from "react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { distributeTarget } from "@/lib/planning-distribute";
import { toast } from "sonner";
import { formatMetricValue } from "@/lib/planning-format";
import type { DistributeCurve } from "@/types/planning";

interface Props {
  open: boolean;
  onClose: () => void;
  metricId: string;
  periodCount: number;
  periodType: "quarter" | "month" | "week";
  year: number;
  initialYearTarget?: number;
  unit?: string | null;
  onApplied: () => void;
}

// Wrapper remounts Inner on open to reset internal draft state without useEffect.
export function AutoDistributeDialog(props: Props) {
  if (!props.open) return null;
  return <AutoDistributeDialogInner key={`${props.initialYearTarget ?? 0}-${props.periodType}`} {...props} />;
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
];

function AutoDistributeDialogInner({
  onClose, metricId, periodCount, periodType, year, initialYearTarget, unit, onApplied,
}: Omit<Props, "open">) {
  const [curve, setCurve] = useState<DistributeCurve>("linear");
  const [yearTarget, setYearTarget] = useState<number>(initialYearTarget ?? 0);

  const preview = useMemo(
    () => distributeTarget(curve, yearTarget || 0, periodCount).map((v, i) => ({ i, v })),
    [curve, yearTarget, periodCount],
  );

  const apply = async () => {
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
            : "Не удалось распределить";
      toast.error(msg);
      return;
    }
    toast.success(`${periodCount} ячеек обновлено`);
    onApplied();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-[600px] rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Распределить цель по {PERIOD_LABEL[periodType]}ам</h2>
        <p className="mt-1 text-xs text-slate-500">
          {periodCount} {PERIOD_LABEL[periodType]}(а/ев) будут обновлены одной операцией. Каждую ячейку
          можно поправить вручную после.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Годовая цель {year}</span>
            <input
              type="number"
              autoFocus
              value={yearTarget || ""}
              onChange={(e) => setYearTarget(Number(e.target.value))}
              placeholder="например, 20000000"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
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
            <div className="h-32 rounded-md border border-slate-200 bg-slate-50 p-2">
              {yearTarget > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={preview}>
                    <XAxis dataKey="i" hide />
                    <YAxis hide />
                    <Line type="monotone" dataKey="v" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="flex h-full items-center justify-center text-xs text-slate-400">
                  Введите годовую цель, чтобы увидеть превью
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            Отмена
          </button>
          <button
            onClick={apply}
            disabled={!yearTarget}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
