"use client";

// P8: компактный summary над табами в карточке клиента.
// Показывает суммарный MRR (для сделок где задан min_monthly_amount и
// pilot_started_at не пустой) + ближайший pilot_planned_end_at среди
// активных pilot-сделок (если он в прошлом — амбер-чип).

import { useCallback, useEffect, useState } from "react";
import type { ClientDeal } from "@/types/planning";

interface Props { clientId: string }

export function ClientLifecycleSummary({ clientId }: Props) {
  const [deals, setDeals] = useState<ClientDeal[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/deals`);
    if (res.ok) setDeals(await res.json());
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  if (!deals) return null;

  // MRR: SUM(min_monthly_amount) для сделок, у которых пилот стартовал.
  const mrr = deals.reduce((s, d) => {
    if (!d.pilot_started_at) return s;
    return s + (d.min_monthly_amount ? Number(d.min_monthly_amount) : 0);
  }, 0);

  // Ближайший pilot_planned_end_at среди активных (production_started_at = null
  // и pilot_started_at задан).
  const activePilots = deals
    .filter((d) => d.pilot_started_at && !d.production_started_at && d.pilot_planned_end_at)
    .map((d) => new Date(d.pilot_planned_end_at!).getTime())
    .sort((a, b) => a - b);
  const earliestPilotEnd = activePilots[0] ?? null;
  const now = Date.now();
  const isOverdue = earliestPilotEnd !== null && earliestPilotEnd < now;
  const daysLeft = earliestPilotEnd !== null ? Math.round((earliestPilotEnd - now) / 86400000) : null;

  if (mrr === 0 && earliestPilotEnd === null) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2 text-xs">
      {mrr > 0 && (
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700">
          MRR: <strong className="tabular-nums">{mrr.toLocaleString("ru-RU")} ₽</strong>
        </span>
      )}
      {earliestPilotEnd !== null && (
        <span
          className={`rounded-md px-2 py-0.5 ${
            isOverdue
              ? "bg-red-100 text-red-700"
              : daysLeft !== null && daysLeft <= 14
                ? "bg-amber-100 text-amber-700"
                : "bg-slate-100 text-slate-700"
          }`}
          title={`Ближайший конец пилота: ${new Date(earliestPilotEnd).toISOString().slice(0, 10)}`}
        >
          {isOverdue
            ? `Пилот просрочен (${new Date(earliestPilotEnd).toISOString().slice(0, 10)})`
            : `Пилот закончится через ${daysLeft} д.`}
        </span>
      )}
    </div>
  );
}
