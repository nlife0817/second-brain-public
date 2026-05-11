"use client";

import { useEffect, useState } from "react";
import type { PlanningInitiative, PlanningInitiativeDependency, PlanningPeriod } from "@/types/planning";

const TYPE_LANE: Record<PlanningInitiative["type"], string> = {
  client_blocker: "Блокер клиента",
  product_maturity: "Зрелость",
  tech_debt: "Тех. долг",
  experiment: "Эксперимент",
  support: "Поддержка",
};

const STATUS_COLOR: Record<PlanningInitiative["status"], string> = {
  planned: "#94a3b8",
  in_progress: "#2563eb",
  done: "#16a34a",
  killed: "#374151",
};

interface Props {
  initiatives: PlanningInitiative[];
  periods: PlanningPeriod[];
}

export function RoadmapGantt({ initiatives, periods }: Props) {
  const [allDeps, setAllDeps] = useState<PlanningInitiativeDependency[]>([]);

  useEffect(() => {
    Promise.all(initiatives.map((i) =>
      fetch(`/api/planning/initiatives/${i.id}/dependencies`).then((r) => r.ok ? r.json() : [])
    )).then((rows) => setAllDeps(rows.flat()));
  }, [initiatives]);

  if (initiatives.length === 0) {
    return <p className="p-8 text-center text-sm text-slate-500">Инициатив пока нет.</p>;
  }

  // Compute time range
  const dates = initiatives.flatMap((i) => {
    const period = periods.find((p) => p.id === i.due_period_id);
    return [i.created_at, period?.end_date].filter(Boolean) as string[];
  });
  const minDate = dates.reduce((a, b) => (a < b ? a : b), dates[0] ?? new Date().toISOString());
  const maxDate = dates.reduce((a, b) => (a > b ? a : b), dates[0] ?? new Date().toISOString());
  const minTs = new Date(minDate).getTime();
  const maxTs = new Date(maxDate).getTime();
  const totalDays = Math.max(1, Math.ceil((maxTs - minTs) / 86400000));

  const lanes = Array.from(new Set(initiatives.map((i) => i.type)));

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-xs text-slate-500">
        {minDate.slice(0, 10)} → {maxDate.slice(0, 10)} · {totalDays} дней
      </p>
      <div className="flex flex-col gap-2">
        {lanes.map((lane) => {
          const items = initiatives.filter((i) => i.type === lane);
          return (
            <div key={lane} className="flex items-stretch gap-3">
              <div className="w-32 shrink-0 text-xs font-semibold text-slate-600">
                {TYPE_LANE[lane]}
              </div>
              <div className="relative h-12 flex-1 rounded-md bg-slate-50">
                {items.map((i) => {
                  const period = periods.find((p) => p.id === i.due_period_id);
                  const startTs = new Date(i.created_at).getTime();
                  const endTs = period ? new Date(period.end_date).getTime() : startTs + 7 * 86400000;
                  const left = ((startTs - minTs) / (maxTs - minTs)) * 100;
                  const width = Math.max(2, ((endTs - startTs) / (maxTs - minTs)) * 100);
                  const isDep = allDeps.some((d) => d.initiative_id === i.id);
                  return (
                    <div
                      key={i.id}
                      title={`${i.title} (${i.status})${isDep ? " · зависит от другой" : ""}`}
                      className="absolute top-1 flex h-10 items-center overflow-hidden rounded-md px-2 text-[10px] text-white"
                      style={{ left: `${left}%`, width: `${width}%`, background: STATUS_COLOR[i.status] }}
                    >
                      <span className="truncate">{i.title}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
