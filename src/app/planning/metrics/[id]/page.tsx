"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { MetricChart } from "@/components/planning/MetricChart";
import { MetricTargetsTable } from "@/components/planning/MetricTargetsTable";
import { AutoDistributeDialog } from "@/components/planning/AutoDistributeDialog";
import type { PlanningMetric, PlanningMetricTarget, PlanningMetricTick, PlanningPeriod } from "@/types/planning";

export default function MetricPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [metric, setMetric] = useState<PlanningMetric | null>(null);
  const [targets, setTargets] = useState<PlanningMetricTarget[]>([]);
  const [ticks, setTicks] = useState<PlanningMetricTick[]>([]);
  const [periods, setPeriods] = useState<PlanningPeriod[]>([]);
  const [periodType, setPeriodType] = useState<"quarter" | "month" | "week">("quarter");
  const [openDistribute, setOpenDistribute] = useState(false);
  const year = new Date().getFullYear();

  const fetchAll = useCallback(async () => {
    const [m, t, ti] = await Promise.all([
      fetch(`/api/planning/metrics/${id}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/planning/metrics/${id}/targets`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/planning/metrics/${id}/ticks?limit=200`).then((r) => r.ok ? r.json() : []),
    ]);
    setMetric(m); setTargets(t); setTicks(ti);
    if (m?.direction_id !== undefined) {
      const url = `/api/planning/periods?type=${periodType}&year=${year}&direction_id=${m?.direction_id ?? "null"}`;
      const p = await fetch(url).then((r) => r.ok ? r.json() : []);
      setPeriods(p);
    }
  }, [id, periodType, year]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (!metric) return <div className="p-6 text-sm text-slate-500">Загрузка…</div>;

  // Chart: combine plan (from targets) + fact (from ticks)
  const chartData = (() => {
    const byDate = new Map<string, { date: string; plan?: number; fact?: number }>();
    for (const t of targets) {
      const p = periods.find((pp) => pp.id === t.period_id);
      if (!p) continue;
      const d = p.end_date;
      const existing = byDate.get(d) ?? { date: d };
      existing.plan = Number(t.target_value);
      byDate.set(d, existing);
    }
    for (const tk of ticks) {
      const d = tk.measured_at.slice(0, 10);
      const existing = byDate.get(d) ?? { date: d };
      existing.fact = Number(tk.value);
      byDate.set(d, existing);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  })();

  const totalTarget = targets.reduce((s, t) => s + Number(t.target_value), 0);
  const totalFact = ticks.reduce((s, t) => s + Number(t.value), 0);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">{metric.title}</h1>
      <p className="text-sm text-slate-500">
        {metric.type === "numeric" ? "Числовая" : metric.type === "business" ? "Бизнес" : "Выполнение"}
        {metric.unit ? ` · ${metric.unit}` : ""}
      </p>

      <div className="mt-6 grid grid-cols-3 gap-6">
        <div className="col-span-2 rounded-xl border border-slate-200 p-4">
          <h2 className="mb-2 text-sm font-semibold">График</h2>
          <MetricChart data={chartData} />
        </div>
        <div className="space-y-3 rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold">Ключевые цифры</h2>
          <KV label="Цель (год)" value={totalTarget} />
          <KV label="Факт" value={totalFact} />
          <KV label="Прогноз" value={totalFact} />
          <KV label="Gap" value={totalTarget - totalFact} />
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Цели по горизонтам</h2>
            <select value={periodType} onChange={(e) => setPeriodType(e.target.value as "quarter" | "month" | "week")} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
              <option value="quarter">Кварталы</option>
              <option value="month">Месяцы</option>
              <option value="week">Недели</option>
            </select>
          </div>
          <button
            onClick={() => setOpenDistribute(true)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
          >
            ↻ Re-distribute по кривой
          </button>
        </div>
        {periods.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            <p>У этой метрики ещё нет разбивки по горизонтам.</p>
            <p className="mt-1 text-xs">Сначала создайте периоды через API или дождитесь авто-создания.</p>
          </div>
        ) : (
          <MetricTargetsTable metricId={metric.id} periods={periods} targets={targets} onChanged={fetchAll} />
        )}
      </div>

      <AutoDistributeDialog
        open={openDistribute}
        onClose={() => setOpenDistribute(false)}
        metricId={metric.id}
        periodCount={periods.length}
        periodType={periodType}
        year={year}
        onApplied={fetchAll}
      />
    </div>
  );
}

function KV({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums">{value.toLocaleString("ru-RU")}</span>
    </div>
  );
}
