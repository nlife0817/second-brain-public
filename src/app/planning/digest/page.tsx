"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PlanningChangeLogEntry, PlanningInitiative, PlanningMetric, PlanningMetricTarget } from "@/types/planning";
import type { Item } from "@/types";

interface DigestData {
  metrics: Array<{ metric: PlanningMetric; targets: PlanningMetricTarget[] }>;
  done_items: Item[];
  done_initiatives: PlanningInitiative[];
  at_risk: PlanningInitiative[];
  early_warning: PlanningInitiative[];
  recent_changes: PlanningChangeLogEntry[];
  blocked_deals: Array<{ id: string; title: string; stage: string; min_monthly_amount: number | null }>;
}

export default function DigestPage() {
  const [data, setData] = useState<DigestData | null>(null);
  useEffect(() => { fetch("/api/planning/digest").then((r) => r.ok ? r.json() : null).then(setData); }, []);
  if (!data) return <div className="p-6 text-sm text-slate-500">Загрузка…</div>;

  const alertCount = data.at_risk.length + data.early_warning.length;

  return (
    <div className="p-6">
      {/* Alert tier */}
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <div className="font-semibold">⚠ Что важно прямо сейчас</div>
        <div className="mt-1 text-xs">
          {alertCount === 0 ? "Активных рисков нет." : `${data.at_risk.length} инициатив в работе · ${data.early_warning.length} требуют внимания`}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Block title="Годовые метрики">
          {data.metrics.length === 0 ? <Empty>Нет метрик</Empty> : data.metrics.map(({ metric, targets }) => {
            const yearTarget = targets.reduce((s, t) => s + Number(t.target_value), 0);
            return (
              <Link href={`/planning/metrics/${metric.id}`} key={metric.id} className="block rounded-md border border-slate-200 p-2 text-xs hover:bg-slate-50">
                <p className="font-medium">{metric.title}</p>
                <p className="text-slate-500">Цель: {yearTarget.toLocaleString("ru-RU")}{metric.unit ? ` ${metric.unit}` : ""}</p>
              </Link>
            );
          })}
        </Block>

        <Block title="Сделано за неделю">
          <p className="text-3xl font-bold">{data.done_items.length}</p>
          <p className="text-xs text-slate-500">задач · {data.done_initiatives.length} инициатив</p>
        </Block>

        <Block title="Стратегия / Поддержка">
          <p className="text-3xl font-bold">—</p>
          <p className="text-xs text-slate-500">Расчёт по часам инициатив (см. /planning/this-month)</p>
        </Block>

        <Block title="В риске">
          <p className="text-3xl font-bold">{data.at_risk.length}</p>
          {data.at_risk.slice(0, 3).map((i) => (
            <p key={i.id} className="text-xs text-slate-500">· {i.title}</p>
          ))}
        </Block>

        <Block title="Раннее предупреждение">
          <p className="text-3xl font-bold">{data.early_warning.length}</p>
          {data.early_warning.slice(0, 3).map((i) => (
            <p key={i.id} className="text-xs text-slate-500">· {i.title}</p>
          ))}
        </Block>

        <Block title="Kill criteria">
          <p className="text-3xl font-bold">—</p>
          <p className="text-xs text-slate-500">Эвристика отслеживается в журнале</p>
        </Block>

        <Block title="Заблокированные сделки">
          <p className="text-3xl font-bold">{data.blocked_deals.length}</p>
          {data.blocked_deals.slice(0, 3).map((d) => (
            <Link href={`/planning/deals/${d.id}`} key={d.id} className="block text-xs text-blue-600 hover:underline">
              {d.title} <span className="text-slate-500">({d.stage})</span>
            </Link>
          ))}
        </Block>

        <Block title="Журнал" className="col-span-2">
          <div className="max-h-40 overflow-y-auto text-xs">
            {data.recent_changes.length === 0 ? <Empty>Записей нет</Empty> :
              data.recent_changes.map((c) => (
                <div key={c.id} className="border-b border-slate-100 py-1">
                  <span className="text-slate-400">{new Date(c.timestamp).toLocaleString("ru-RU")}</span>
                  {" · "}
                  <span className="font-medium">{c.entity_type}</span>
                  {" "}
                  <span className="text-slate-500">{c.action}</span>
                  {c.actor_email ? <span className="text-slate-400"> · {c.actor_email}</span> : null}
                </div>
              ))
            }
          </div>
        </Block>
      </div>
    </div>
  );
}

function Block({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 p-4 ${className ?? ""}`}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-400">{children}</p>;
}
