"use client";

import Link from "next/link";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import type { PlanningMetric } from "@/types/planning";
import { InlineTextField } from "./InlineTextField";
import { usePlanningStore } from "@/lib/planning-store";

interface Props { metric: PlanningMetric; selected: boolean; onSelect: () => void; sparkline?: number[]; }

export function MetricCard({ metric, selected, onSelect, sparkline }: Props) {
  const updateMetric = usePlanningStore((s) => s.updateMetric);
  const series = (sparkline ?? []).map((v, i) => ({ i, v }));
  return (
    <div
      onClick={onSelect}
      className={`group flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors ${
        selected ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1" onClick={(e) => e.stopPropagation()}>
          <InlineTextField
            value={metric.title}
            onSave={(t) => updateMetric(metric.id, { title: t })}
            className="text-sm font-medium"
          />
          <p className="px-2 text-xs text-slate-500">
            {metric.type === "numeric" ? "Числовая" : metric.type === "business" ? "Бизнес" : "Выполнение"}
            {metric.unit ? ` · ${metric.unit}` : ""}
          </p>
        </div>
        <Link
          href={`/planning/metrics/${metric.id}`}
          onClick={(e) => e.stopPropagation()}
          className="rounded-md px-1.5 py-0.5 text-xs text-blue-600 opacity-0 group-hover:opacity-100"
        >
          →
        </Link>
      </div>
      {series.length > 1 && (
        <div className="h-6 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <Line type="monotone" dataKey="v" stroke="#2563eb" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
