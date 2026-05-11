"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PlanningChangeLogEntry, PlanningInitiative, PlanningMetric, PlanningMetricTarget, PlanningMetricTick, PlanningSettings } from "@/types/planning";
import type { Item } from "@/types";
import { Sparkline } from "@/components/planning/Sparkline";

interface DigestData {
  settings: PlanningSettings;
  metrics: Array<{ metric: PlanningMetric; targets: PlanningMetricTarget[]; recent_ticks: PlanningMetricTick[] }>;
  done_items: Item[];
  done_initiatives: PlanningInitiative[];
  at_risk: PlanningInitiative[];
  early_warning: PlanningInitiative[];
  recent_changes: PlanningChangeLogEntry[];
  blocked_deals: Array<{ id: string; title: string; stage: string; min_monthly_amount: number | null }>;
  strategy_support: {
    strategy_hours: number;
    support_hours: number;
    ratio: number;
    target_ratio: number;
    warning: boolean;
  };
  overdue_pilots: Array<{ id: string; title: string; pilot_planned_end_at: string }>;
  kill_criteria_count: number;
}

export default function DigestPage() {
  const [data, setData] = useState<DigestData | null>(null);
  useEffect(() => { fetch("/api/planning/digest").then((r) => r.ok ? r.json() : null).then(setData); }, []);
  if (!data) return <DigestSkeleton />;

  const alertCount = data.at_risk.length + data.early_warning.length + data.overdue_pilots.length + data.kill_criteria_count;
  const ratioPercent = Math.round(data.strategy_support.ratio * 100);
  const targetPercent = Math.round(data.strategy_support.target_ratio * 100);

  return (
    <div className="p-6">
      {/* Alert tier */}
      <div className={`mb-4 rounded-xl border p-4 text-sm ${
        alertCount === 0
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-200 bg-amber-50 text-amber-800"
      }`}>
        <div className="font-semibold">{alertCount === 0 ? "✓ Всё под контролем" : "⚠ Что важно прямо сейчас"}</div>
        <div className="mt-1 text-xs">
          {alertCount === 0
            ? "Активных рисков нет."
            : [
                data.at_risk.length ? `${data.at_risk.length} в работе` : null,
                data.early_warning.length ? `${data.early_warning.length} с приближением дедлайна` : null,
                data.overdue_pilots.length ? `${data.overdue_pilots.length} просроченных пилотов` : null,
                data.kill_criteria_count ? `${data.kill_criteria_count} kill criteria` : null,
              ].filter(Boolean).join(" · ")}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Block title="Годовые метрики" className="col-span-2">
          {data.metrics.length === 0 ? <Empty>Нет метрик</Empty> : (
            <div className="grid grid-cols-2 gap-2">
              {data.metrics.map(({ metric, targets, recent_ticks }) => {
                const yearTarget = targets.reduce((s, t) => s + Number(t.target_value), 0);
                const sparkData = recent_ticks
                  .slice()
                  .reverse()
                  .map((t) => ({ x: t.measured_at, y: Number(t.value) }));
                const lastValue = sparkData.length ? sparkData[sparkData.length - 1].y : null;
                const progressPercent = yearTarget > 0 && lastValue !== null ? Math.round((lastValue / yearTarget) * 100) : null;
                return (
                  <Link href={`/planning/metrics/${metric.id}`} key={metric.id} className="block rounded-md border border-slate-200 p-2 hover:bg-slate-50">
                    <p className="text-xs font-medium truncate">{metric.title}</p>
                    <Sparkline data={sparkData} />
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      Цель: {yearTarget.toLocaleString("ru-RU")}{metric.unit ? ` ${metric.unit}` : ""}
                      {progressPercent !== null ? ` · ${progressPercent}%` : ""}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </Block>

        <Block title="Сделано за неделю">
          <p className="text-3xl font-bold">{data.done_items.length}</p>
          <p className="text-xs text-slate-500">задач · {data.done_initiatives.length} инициатив</p>
        </Block>

        <Block title="Стратегия / Поддержка">
          {data.strategy_support.strategy_hours + data.strategy_support.support_hours === 0 ? (
            <p className="text-3xl font-bold text-slate-300">—</p>
          ) : (
            <>
              <p className={`text-3xl font-bold ${data.strategy_support.warning ? "text-amber-600" : "text-slate-900"}`}>
                {ratioPercent}%
              </p>
              <p className="text-xs text-slate-500">
                Цель: {targetPercent}% · {data.strategy_support.warning ? "вне диапазона 60-80%" : "в норме"}
              </p>
              <div className="mt-1 h-2 w-full overflow-hidden rounded bg-slate-100">
                <div
                  className={`h-full ${data.strategy_support.warning ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min(100, ratioPercent)}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-slate-400 tabular-nums">
                {data.strategy_support.strategy_hours}ч стратегии · {data.strategy_support.support_hours}ч поддержки
              </p>
            </>
          )}
        </Block>

        <Block title="В риске">
          <p className="text-3xl font-bold">{data.at_risk.length}</p>
          {data.at_risk.slice(0, 3).map((i) => (
            <p key={i.id} className="text-xs text-slate-500 truncate">· {i.title}</p>
          ))}
        </Block>

        <Block title="Раннее предупреждение">
          <p className="text-3xl font-bold">{data.early_warning.length}</p>
          {data.early_warning.slice(0, 3).map((i) => (
            <p key={i.id} className="text-xs text-slate-500 truncate">· {i.title}</p>
          ))}
        </Block>

        <Block title="Kill criteria">
          <p className="text-3xl font-bold">{data.kill_criteria_count}</p>
          <p className="text-xs text-slate-500">Сработавших за 7 дней</p>
        </Block>

        <Block title="Просроченные пилоты">
          <p className="text-3xl font-bold text-red-600">{data.overdue_pilots.length}</p>
          {data.overdue_pilots.slice(0, 3).map((p) => (
            <Link href={`/planning/deals/${p.id}`} key={p.id} className="block text-xs text-blue-600 hover:underline truncate">
              {p.title} <span className="text-slate-400">· до {p.pilot_planned_end_at.slice(0, 10)}</span>
            </Link>
          ))}
        </Block>

        <Block title="Заблокированные сделки">
          <p className="text-3xl font-bold">{data.blocked_deals.length}</p>
          {data.blocked_deals.slice(0, 3).map((d) => (
            <Link href={`/planning/deals/${d.id}`} key={d.id} className="block text-xs text-blue-600 hover:underline truncate">
              {d.title} <span className="text-slate-500">({d.stage})</span>
            </Link>
          ))}
        </Block>

        <Block title="Журнал" className="col-span-3">
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

function DigestSkeleton() {
  return (
    <div className="p-6">
      <div className="mb-4 h-20 animate-pulse rounded-xl bg-slate-100" />
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
    </div>
  );
}
