"use client";

import { useEffect, useState, useCallback } from "react";
import { RetrospectiveEditor } from "@/components/planning/RetrospectiveEditor";
import type { PlanningInitiative, PlanningPeriod } from "@/types/planning";

export default function ThisQuarterPage() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const [period, setPeriod] = useState<PlanningPeriod | null>(null);
  const [initiatives, setInitiatives] = useState<PlanningInitiative[]>([]);

  const fetchAll = useCallback(async () => {
    const periods = await fetch(`/api/planning/periods?type=quarter&year=${year}`).then((r) => r.ok ? r.json() : []);
    const p: PlanningPeriod | undefined = periods.find((pp: PlanningPeriod) => pp.quarter_n === quarter);
    setPeriod(p ?? null);
    const inis = await fetch("/api/planning/initiatives").then((r) => r.ok ? r.json() : []);
    setInitiatives(inis);
  }, [year, quarter]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const dueThisQuarter = initiatives.filter((i) => i.due_period_id === period?.id);
  const done = initiatives.filter((i) => i.status === "done");

  // Last week of quarter?
  const showRetro = period ? new Date(period.end_date).getTime() - Date.now() < 7 * 86400000 : false;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Этот квартал {period ? `· ${period.start_date} → ${period.end_date}` : ""}</h1>

      <div className="mt-6 grid grid-cols-3 gap-6">
        <Card title="Дедлайны в квартале">{dueThisQuarter.length}</Card>
        <Card title="Закрыто за квартал">{done.filter((i) => i.done_at && period && i.done_at >= period.start_date && i.done_at <= period.end_date).length}</Card>
        <Card title="Capacity квартала">{period?.capacity_hours ?? "—"}</Card>
      </div>

      {period && showRetro && (
        <div className="mt-6">
          <RetrospectiveEditor periodId={period.id} initial={period.retrospective} onSaved={fetchAll} />
        </div>
      )}
      {period && !showRetro && (
        <div className="mt-6">
          <RetrospectiveEditor periodId={period.id} initial={period.retrospective} onSaved={fetchAll} />
        </div>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-3xl font-bold">{children}</p>
    </div>
  );
}
