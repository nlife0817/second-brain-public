"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, AlertTriangle, Skull, Circle } from "lucide-react";
import type { PlanningInitiative, PlanningPeriod } from "@/types/planning";
import { initiativeStatusTone, SEMANTIC_CLASS } from "@/lib/planning-colors";

interface Props {
  metricId: string;
  periods: PlanningPeriod[];
}

interface InitiativeDetail extends PlanningInitiative {
  linked_metrics?: Array<{ metric_id: string }>;
}

// Concept §4 + §20.2.4. Matrix of initiatives × deadlines for "Выполнение" metric type.
export function DeliveryMetricMatrix({ metricId, periods }: Props) {
  const [initiatives, setInitiatives] = useState<InitiativeDetail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const all = await fetch(`/api/planning/initiatives`).then((r) => r.ok ? r.json() as Promise<PlanningInitiative[]> : []);
      // Fetch each initiative's metric links (chatty but correct for V3 scale).
      const details = await Promise.all(
        all.map((i) =>
          fetch(`/api/planning/initiatives/${i.id}`).then((r) => r.ok ? r.json() as Promise<InitiativeDetail> : null)
        )
      );
      const linked = details.filter((d): d is InitiativeDetail =>
        !!d && (d.linked_metrics ?? []).some((l) => l.metric_id === metricId)
      );
      if (!cancelled) {
        setInitiatives(linked);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [metricId]);

  if (loading) return <div className="py-8 text-center text-sm text-slate-500">Загрузка матрицы…</div>;

  if (initiatives.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-slate-500">
        <p>К этой метрике не привязано ни одной инициативы.</p>
        <p className="mt-1 text-xs">Привяжите инициативы через карточку инициативы (Связанные метрики).</p>
      </div>
    );
  }

  const sortedPeriods = periods.slice().sort((a, b) => a.start_date.localeCompare(b.start_date));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2">Инициатива</th>
            {sortedPeriods.map((p) => (
              <th key={p.id} className="border-b border-slate-200 px-3 py-2 text-center">
                {labelForPeriod(p)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {initiatives.map((i) => {
            const tone = initiativeStatusTone(i.status);
            const dotCls = SEMANTIC_CLASS[tone].dot;
            return (
              <tr key={i.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="sticky left-0 z-10 max-w-[280px] truncate bg-white px-3 py-2 hover:bg-slate-50">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 shrink-0 rounded-full ${dotCls}`} />
                    <Link href={`/planning/columns`} className="truncate hover:text-blue-600">
                      {i.title}
                    </Link>
                  </div>
                </td>
                {sortedPeriods.map((p) => {
                  const isDue = i.due_period_id === p.id;
                  if (!isDue) {
                    return <td key={p.id} className="px-3 py-2 text-center text-slate-200">·</td>;
                  }
                  return (
                    <td key={p.id} className="px-3 py-2 text-center">
                      <DeliveryCell initiative={i} period={p} today={today} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <LegendItem icon={<CheckCircle2 className="size-3.5 text-emerald-600" />} label="В срок" />
        <LegendItem icon={<Clock className="size-3.5 text-blue-600" />} label="В работе" />
        <LegendItem icon={<AlertTriangle className="size-3.5 text-red-600" />} label="Пропущен" />
        <LegendItem icon={<Circle className="size-3.5 text-slate-400" />} label="Запланирована" />
        <LegendItem icon={<Skull className="size-3.5 text-slate-700" />} label="Убита" />
      </div>
    </div>
  );
}

function DeliveryCell({ initiative, period, today }: { initiative: PlanningInitiative; period: PlanningPeriod; today: string }) {
  const past = period.end_date < today;
  if (initiative.status === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="size-3.5" /> done
      </span>
    );
  }
  if (initiative.status === "killed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
        <Skull className="size-3.5" /> killed
      </span>
    );
  }
  if (past) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
        <AlertTriangle className="size-3.5" /> просрочена
      </span>
    );
  }
  if (initiative.status === "in_progress") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
        <Clock className="size-3.5" /> в работе
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
      <Circle className="size-3.5" /> planned
    </span>
  );
}

function LegendItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <span className="inline-flex items-center gap-1">{icon}{label}</span>;
}

function labelForPeriod(p: PlanningPeriod): string {
  if (p.type === "week" && p.week_n) return `W${p.week_n}`;
  if (p.type === "month" && p.month_n) return `${String(p.month_n).padStart(2, "0")}.${p.year}`;
  if (p.type === "quarter" && p.quarter_n) return `Q${p.quarter_n}`;
  return p.start_date.slice(0, 10);
}
