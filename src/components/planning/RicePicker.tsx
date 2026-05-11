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
export function RicePicker({ reach, impact, confidence, estimateHours, riceScore, autoReach, onChange }: Props) {
  const usingAutoReach = reach === null || reach === undefined;
  const effectiveReach = usingAutoReach ? autoReach : reach;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">RICE</h3>
        <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
          Score {riceScore > 0 ? riceScore.toFixed(1) : "—"}
        </span>
      </div>

      <div className="grid gap-3 text-sm">
        {/* Reach */}
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label className="text-xs font-medium text-slate-700">Reach (охват)</label>
            <button
              type="button"
              onClick={() => onChange({ rice_reach: null })}
              className={`text-[10px] uppercase ${usingAutoReach ? "font-semibold text-blue-600" : "text-slate-400 hover:text-blue-600"}`}
              title="Сбросить до авто-значения = сделки + клиенты"
            >
              Авто ({autoReach})
            </button>
          </div>
          <input
            type="number"
            min={0}
            value={effectiveReach ?? 0}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange({ rice_reach: v });
            }}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Impact */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Impact (влияние)</label>
          <div className="flex flex-wrap gap-1">
            {RICE_IMPACT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ rice_impact: opt.value })}
                className={`flex flex-col items-center rounded-md border px-2 py-1 text-xs transition-colors ${
                  impact === opt.value
                    ? "border-blue-500 bg-blue-50 font-semibold text-blue-700"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                }`}
              >
                <span>{opt.label}</span>
                <span className="text-[9px] tabular-nums opacity-60">{opt.value}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Confidence */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Confidence (уверенность)</label>
          <div className="flex flex-wrap gap-1">
            {RICE_CONFIDENCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ rice_confidence: opt.value })}
                className={`flex flex-col items-center rounded-md border px-2 py-1 text-xs transition-colors ${
                  confidence === opt.value
                    ? "border-blue-500 bg-blue-50 font-semibold text-blue-700"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                }`}
              >
                <span>{opt.label}</span>
                <span className="text-[9px] tabular-nums opacity-60">{opt.percent}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Effort hint */}
        <div className="text-xs text-slate-500">
          Effort = <span className="tabular-nums">{estimateHours ?? "—"}</span> ч (берётся из «Оценка»)
        </div>
      </div>
    </div>
  );
}
