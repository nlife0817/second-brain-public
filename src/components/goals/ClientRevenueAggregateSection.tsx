"use client";

// Read-only aggregate of weekly client revenue, shown on year/quarter/month
// goals. Lists unique clients across all descendant weeks with their total
// amount over the period and a "active in last week" flag. A simple sparkline
// renders the per-week sums for at-a-glance trend.

import { useEffect, useMemo, useState } from "react";
import type { ClientRevenueAggregateRow, GoalFull } from "@/types";
import { cn } from "@/lib/utils";

interface AggregateData {
  rows: ClientRevenueAggregateRow[];
  weekly_totals: { goal_id: string; period_start: string | null; total: number; active_count: number }[];
}

export function ClientRevenueAggregateSection({ goal }: { goal: GoalFull }) {
  const [data, setData] = useState<AggregateData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const r = await fetch(`/api/goals/${goal.id}/clients/aggregate`);
        if (r.ok && !cancelled) {
          const d: AggregateData = await r.json();
          setData(d);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [goal.id]);

  const total = useMemo(
    () => (data?.rows ?? []).reduce((s, r) => s + r.total_amount, 0),
    [data?.rows],
  );
  const activeNow = useMemo(
    () => (data?.rows ?? []).filter((r) => r.active_in_last_week).length,
    [data?.rows],
  );

  const weeklyMax = useMemo(
    () => Math.max(1, ...(data?.weekly_totals ?? []).map((w) => w.total)),
    [data?.weekly_totals],
  );

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
        Клиенты с выручкой (сводка)
      </h3>

      {loading ? (
        <p className="text-[11px] text-slate-400">Загрузка…</p>
      ) : !data || data.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-[11px] text-slate-400">
          В дочерних неделях нет записей о клиентах.
        </p>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px]">
            <span className="text-slate-500">
              Активных на последнюю неделю: <span className="font-medium text-slate-900">{activeNow}</span>
            </span>
            <span className="tabular-nums font-medium text-slate-900">
              ∑ {total.toLocaleString("ru-RU")} ₽
            </span>
          </div>

          {data.weekly_totals.length > 0 && (
            <div className="mb-2 rounded-md border border-slate-200 bg-white p-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
                Динамика по неделям
              </div>
              <div className="flex h-12 items-end gap-0.5">
                {data.weekly_totals.map((w) => {
                  const h = Math.max(2, Math.round((w.total / weeklyMax) * 44));
                  return (
                    <div
                      key={w.goal_id}
                      className="group flex flex-1 flex-col items-center gap-0.5"
                      title={`${w.period_start ?? ""} · ${w.total.toLocaleString("ru-RU")} ₽ · ${w.active_count} активных`}
                    >
                      <div
                        className="w-full rounded-t bg-violet-200 transition group-hover:bg-violet-400"
                        style={{ height: `${h}px` }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-0.5">
            {data.rows.map((r) => (
              <div
                key={r.client_id}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2 py-1 text-[11px]",
                  r.active_in_last_week ? "border-slate-200 bg-white" : "border-rose-100 bg-rose-50/40",
                )}
              >
                <span className={cn(
                  "min-w-0 flex-1 truncate",
                  r.active_in_last_week ? "text-slate-800" : "text-rose-700",
                )}>
                  {r.client_name}
                </span>
                {!r.active_in_last_week && (
                  <span className="rounded bg-rose-100 px-1 py-0.5 text-[9px] font-medium text-rose-600">
                    отвалился
                  </span>
                )}
                <span className="tabular-nums font-medium text-slate-900">
                  {r.total_amount.toLocaleString("ru-RU")} ₽
                </span>
                <span className="text-[10px] text-slate-400">
                  {r.weeks.length} нед.
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
