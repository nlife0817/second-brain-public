"use client";

import { memo } from "react";
import Link from "next/link";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { Pencil, ExternalLink } from "lucide-react";
import type { PlanningMetric } from "@/types/planning";
import { InlineTextField } from "./InlineTextField";
import { usePlanningStore } from "@/lib/planning-store";
import { formatMetricValue } from "@/lib/planning-format";

interface Props {
  metric: PlanningMetric;
  selected: boolean;
  onSelect: () => void;
  onOpenDetail?: () => void;
  sparkline?: number[];
  latestValue?: number | null;
  /** P4.5: YTD-агрегат для variance indicator под фактом. */
  ytd?: { annual_target: number | null; target_ytd: number; actual_ytd: number; variance: number };
}

const TYPE_LABEL: Record<PlanningMetric["type"], string> = {
  numeric: "Числовая",
  business: "Бизнес",
  delivery: "Выполнение",
};

const TYPE_TONE: Record<PlanningMetric["type"], string> = {
  numeric: "bg-sky-50 text-sky-700",
  business: "bg-emerald-50 text-emerald-700",
  delivery: "bg-violet-50 text-violet-700",
};

function MetricCardBase({ metric, selected, onSelect, onOpenDetail, sparkline, latestValue, ytd }: Props) {
  const updateMetric = usePlanningStore((s) => s.updateMetric);
  const series = (sparkline ?? []).map((v, i) => ({ i, v }));

  // Variance vs план YTD: positive = «лучше плана» (с учётом direction_value).
  const variance = ytd?.variance ?? null;
  const targetYtd = ytd?.target_ytd ?? null;
  const hasVariance = variance !== null && targetYtd !== null && targetYtd > 0;
  const isImproving = variance === null
    ? null
    : metric.direction_value === "down" ? variance <= 0 : variance >= 0;
  const varianceColor = isImproving === null ? "text-slate-400"
    : isImproving ? "text-emerald-600" : "text-red-600";

  // Тренд для цвета линии: вверх или вниз относительно baseline (если есть)
  // и относительно direction_value (up/down — что считать «хорошо»).
  const last = series.length ? series[series.length - 1].v : null;
  const first = series.length ? series[0].v : null;
  let lineColor = "#2563eb"; // default: in_progress blue
  if (last != null && first != null && metric.direction_value) {
    const improving = metric.direction_value === "up" ? last >= first : last <= first;
    lineColor = improving ? "#16a34a" : "#dc2626"; // on_track / off_track
  }

  return (
    <div
      onClick={onSelect}
      className={`group flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors ${
        selected ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
          <InlineTextField
            value={metric.title}
            onSave={(t) => updateMetric(metric.id, { title: t })}
            className="text-sm font-medium"
          />
          <div className="flex flex-wrap items-center gap-1 px-2 pt-0.5">
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${TYPE_TONE[metric.type]}`}>
              {TYPE_LABEL[metric.type]}
            </span>
            {metric.unit && (
              <span className="text-[10px] text-slate-400">·</span>
            )}
            {metric.unit && (
              <span className="text-[10px] text-slate-500">{metric.unit}</span>
            )}
          </div>
        </div>
        <div
          className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {onOpenDetail && (
            <button
              onClick={onOpenDetail}
              className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-blue-600"
              title="Редактировать метрику (drawer)"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          <Link
            href={`/planning/metrics/${metric.id}`}
            className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-blue-600"
            title="Открыть полную страницу метрики"
          >
            <ExternalLink className="size-3.5" />
          </Link>
        </div>
      </div>

      {/* Текущее значение + sparkline. Concept §20.2.1: «sparkline (Recharts mini LineChart 50×20)». */}
      <div className="flex items-end justify-between gap-2 px-2">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">Факт</span>
          <span className="text-sm font-semibold tabular-nums text-slate-800">
            {formatMetricValue(latestValue ?? metric.baseline, metric.unit)}
          </span>
          {hasVariance && (
            <span
              className={`text-[10px] tabular-nums ${varianceColor}`}
              title={`План YTD: ${formatMetricValue(targetYtd!, metric.unit)} · Факт YTD: ${formatMetricValue(ytd!.actual_ytd, metric.unit)}`}
            >
              {variance! > 0 ? "+" : ""}{formatMetricValue(variance!, metric.unit)} vs план YTD
            </span>
          )}
        </div>
        {series.length > 1 ? (
          <div className="h-5" style={{ width: 50 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <Line type="monotone" dataKey="v" stroke={lineColor} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <span className="text-[10px] text-slate-300">нет данных</span>
        )}
      </div>
    </div>
  );
}

export const MetricCard = memo(MetricCardBase);
