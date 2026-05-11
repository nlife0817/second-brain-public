"use client";

import { useEffect, useState, useCallback } from "react";
import type { PlanningInitiative, PlanningMetric, PlanningPeriod, PlanningMetricTarget } from "@/types/planning";

export default function ThisMonthPage() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const [period, setPeriod] = useState<PlanningPeriod | null>(null);
  const [initiatives, setInitiatives] = useState<PlanningInitiative[]>([]);
  const [metrics, setMetrics] = useState<PlanningMetric[]>([]);
  const [targets, setTargets] = useState<PlanningMetricTarget[]>([]);

  const fetchAll = useCallback(async () => {
    const periods = await fetch(`/api/planning/periods?type=month&year=${year}`).then((r) => r.ok ? r.json() : []);
    const p: PlanningPeriod | undefined = periods.find((pp: PlanningPeriod) => pp.month_n === month);
    setPeriod(p ?? null);
    const inis = await fetch("/api/planning/initiatives").then((r) => r.ok ? r.json() : []);
    setInitiatives(inis);
    const mets = await fetch("/api/planning/metrics").then((r) => r.ok ? r.json() : []);
    setMetrics(mets);
    if (p) {
      const allTargets: PlanningMetricTarget[] = [];
      for (const m of mets) {
        const ts = await fetch(`/api/planning/metrics/${m.id}/targets`).then((r) => r.ok ? r.json() : []);
        for (const t of ts) if (t.period_id === p.id) allTargets.push(t);
      }
      setTargets(allTargets);
    }
  }, [year, month]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const strategy = initiatives.filter((i) => ["client_blocker", "product_maturity", "experiment"].includes(i.type));
  const support = initiatives.filter((i) => ["tech_debt", "support"].includes(i.type));
  const strategyHours = strategy.reduce((s, i) => s + Number(i.estimate_hours ?? 0), 0);
  const supportHours = support.reduce((s, i) => s + Number(i.estimate_hours ?? 0), 0);
  const totalHours = strategyHours + supportHours;
  const strategyRatio = totalHours > 0 ? Math.round((strategyHours / totalHours) * 100) : 0;

  const dueThisMonth = initiatives.filter((i) => i.due_period_id === period?.id);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Этот месяц {period ? `· ${period.start_date} → ${period.end_date}` : ""}</h1>

      <div className="mt-6 grid grid-cols-3 gap-6">
        <Card title="Стратегия / Поддержка">
          <p className="text-3xl font-bold">{strategyRatio}% / {100 - strategyRatio}%</p>
          <p className="mt-1 text-xs text-slate-500">{strategyHours}ч стратегия · {supportHours}ч поддержка</p>
        </Card>
        <Card title="Инициативы в дедлайн">
          <p className="text-3xl font-bold">{dueThisMonth.length}</p>
        </Card>
        <Card title="Capacity месяца">
          <p className="text-3xl font-bold">{period?.capacity_hours ?? "—"}</p>
        </Card>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold">Цели метрик</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Метрика</th>
                <th className="px-3 py-2 text-right">Цель</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => {
                const t = targets.find((tt) => tt.metric_id === m.id);
                return (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{m.title}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t ? Number(t.target_value).toLocaleString("ru-RU") : "—"}</td>
                  </tr>
                );
              })}
              {metrics.length === 0 && <tr><td className="px-3 py-4 text-center text-slate-400" colSpan={2}>Метрик нет</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
