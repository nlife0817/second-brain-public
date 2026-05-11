"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { RetrospectiveEditor } from "@/components/planning/RetrospectiveEditor";
import type { PlanningPeriod, PlanningChangeLogEntry } from "@/types/planning";

export default function QuarterRetrospectivePage() {
  const params = useParams<{ period_id: string }>();
  const id = params.period_id;
  const [period, setPeriod] = useState<PlanningPeriod | null>(null);
  const [logs, setLogs] = useState<PlanningChangeLogEntry[]>([]);

  useEffect(() => {
    fetch(`/api/planning/periods/${id}`).then((r) => r.ok ? r.json() : null).then(setPeriod);
  }, [id]);

  useEffect(() => {
    if (!period) return;
    const qs = new URLSearchParams({ from: period.start_date, to: period.end_date, limit: "500" });
    fetch(`/api/planning/changelog?${qs}`).then((r) => r.ok ? r.json() : []).then(setLogs);
  }, [period]);

  if (!period) return <div className="p-6 text-sm text-slate-500">Загрузка…</div>;

  const replanCounts = logs.reduce<Record<string, number>>((acc, l) => {
    const code = (l.replan_reason as { code?: string } | null)?.code;
    if (code) acc[code] = (acc[code] ?? 0) + 1;
    return acc;
  }, {});
  const killed = logs.filter((l) => l.entity_type === "initiative" && (l.diff as Record<string, { from: unknown; to: unknown }> | null)?.status?.to === "killed");

  return (
    <div className="p-6">
      <h1 className="mb-1 text-2xl font-semibold">Ретроспектива квартала</h1>
      <p className="mb-4 text-sm text-slate-500">{period.start_date} → {period.end_date}</p>

      <RetrospectiveEditor periodId={id} initial={period.retrospective} onSaved={() => {}} />

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 p-4">
          <h2 className="mb-2 text-sm font-semibold">Топ причин переплана</h2>
          <ul className="text-sm">
            {Object.entries(replanCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <li key={k} className="flex justify-between border-b border-slate-100 py-1">
                <span>{k}</span><span className="tabular-nums text-slate-500">{v}</span>
              </li>
            ))}
            {Object.keys(replanCounts).length === 0 && <li className="text-xs text-slate-400">Не было переплана</li>}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <h2 className="mb-2 text-sm font-semibold">Убитые инициативы</h2>
          <p className="text-3xl font-bold">{killed.length}</p>
        </div>
      </div>
    </div>
  );
}
