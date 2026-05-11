"use client";

import { useState, useMemo } from "react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { distributeTarget } from "@/lib/planning-distribute";
import { toast } from "sonner";
import type { DistributeCurve } from "@/types/planning";

interface Props {
  open: boolean;
  onClose: () => void;
  metricId: string;
  periodCount: number;
  periodType: "quarter" | "month" | "week";
  year: number;
  onApplied: () => void;
}

const CURVES: Array<{ value: DistributeCurve; label: string }> = [
  { value: "linear", label: "Линейная" },
  { value: "s_curve", label: "S-кривая" },
  { value: "front_loaded", label: "Front-loaded" },
  { value: "back_loaded", label: "Back-loaded" },
];

export function AutoDistributeDialog({ open, onClose, metricId, periodCount, periodType, year, onApplied }: Props) {
  const [curve, setCurve] = useState<DistributeCurve>("linear");
  const [yearTarget, setYearTarget] = useState(0);
  const preview = useMemo(() => distributeTarget(curve, yearTarget || 0, periodCount).map((v, i) => ({ i, v })), [curve, yearTarget, periodCount]);

  if (!open) return null;

  const apply = async () => {
    const res = await fetch(`/api/planning/metrics/${metricId}/targets/distribute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ curve, year_target: yearTarget, period_type: periodType, year }),
    });
    if (!res.ok) { toast.error("Не удалось распределить"); return; }
    toast.success(`${periodCount} ячеек обновлено`);
    onApplied();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-[560px] rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Распределить цели по кривой</h2>
        <div className="mt-4 flex flex-col gap-3">
          <label className="text-sm">
            Годовая цель
            <input
              type="number"
              value={yearTarget}
              onChange={(e) => setYearTarget(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <div>
            <p className="mb-1 text-xs text-slate-500">Кривая</p>
            <div className="flex flex-wrap gap-1.5">
              {CURVES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCurve(c.value)}
                  className={`rounded-md border px-3 py-1 text-xs ${
                    curve === c.value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-32 rounded-md border border-slate-200 bg-slate-50 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={preview}>
                <XAxis dataKey="i" hide />
                <YAxis hide />
                <Line type="monotone" dataKey="v" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Отмена</button>
          <button onClick={apply} disabled={!yearTarget} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">Применить</button>
        </div>
      </div>
    </div>
  );
}
