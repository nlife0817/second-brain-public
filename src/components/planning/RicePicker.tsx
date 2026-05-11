"use client";

import { RICE_IMPACT_OPTIONS, RICE_CONFIDENCE_OPTIONS } from "@/lib/zod/initiative";

interface Props {
  reach: number | null;
  impact: number | null;
  confidence: number | null;
  estimateHours: number | null;
  riceScore: number;
  autoReach: number;
  onChange: (patch: { rice_reach?: number | null; rice_impact?: number | null; rice_confidence?: number | null }) => void;
}

// Concept §3.4.3 + §6.7.4. Reach auto = linked_deal_ids + linked_client_ids.
// EN labels per PLAN_PLANNING_REWORK §0.
//
// Важно: postgres.js возвращает numeric колонки строкой ("1.00"), поэтому
// сравнение `impact === opt.value` (number) всегда было false и кнопки
// «не залипали». Везде нормализуем через Number(...).
export function RicePicker({ reach, impact, confidence, estimateHours, riceScore, autoReach, onChange }: Props) {
  const usingAutoReach = reach === null || reach === undefined;
  const numericReach = reach === null || reach === undefined ? null : Number(reach);
  const numericImpact = impact === null || impact === undefined ? null : Number(impact);
  const numericConfidence = confidence === null || confidence === undefined ? null : Number(confidence);
  const effectiveReach = usingAutoReach ? autoReach : numericReach ?? 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">RICE</h3>
        <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
          Score {Number(riceScore) > 0 ? Number(riceScore).toFixed(1) : "—"}
        </span>
      </div>

      <div className="grid gap-3 text-sm">
        {/* Reach */}
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label className="text-xs font-medium text-slate-700">Reach</label>
            <button
              type="button"
              onClick={() => onChange({ rice_reach: null })}
              className={`text-[10px] uppercase ${usingAutoReach ? "font-semibold text-blue-600" : "text-slate-400 hover:text-blue-600"}`}
              title="Сбросить до авто-значения = сделки + клиенты"
            >
              Auto ({autoReach})
            </button>
          </div>
          <input
            type="number"
            min={0}
            value={effectiveReach}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange({ rice_reach: v });
            }}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Impact */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Impact</label>
          <div className="flex flex-wrap gap-1">
            {RICE_IMPACT_OPTIONS.map((opt) => {
              const active = numericImpact !== null && numericImpact === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ rice_impact: opt.value })}
                  className={`flex flex-col items-center rounded-md border px-2 py-1 text-xs transition-colors ${
                    active
                      ? "border-blue-500 bg-blue-50 font-semibold text-blue-700"
                      : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                  }`}
                >
                  <span>{opt.label}</span>
                  <span className="text-[9px] tabular-nums opacity-60">{opt.value}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Confidence */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Confidence</label>
          <div className="flex flex-wrap gap-1">
            {RICE_CONFIDENCE_OPTIONS.map((opt) => {
              const active = numericConfidence !== null && numericConfidence === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ rice_confidence: opt.value })}
                  className={`flex flex-col items-center rounded-md border px-2 py-1 text-xs transition-colors ${
                    active
                      ? "border-blue-500 bg-blue-50 font-semibold text-blue-700"
                      : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                  }`}
                >
                  <span>{opt.label}</span>
                  <span className="text-[9px] tabular-nums opacity-60">{opt.percent}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Effort hint */}
        <div className="text-xs text-slate-500">
          Effort = <span className="tabular-nums">{estimateHours ?? "—"}</span> h (from Estimate)
        </div>
      </div>
    </div>
  );
}
