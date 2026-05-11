"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface BlockedDeal {
  deal: { id: string; title: string; stage: string; min_monthly_amount: number | null; };
  blockers: Array<{ id: string; title: string; status: string; type: string }>;
}

export default function BlockedDealsPage() {
  const [rows, setRows] = useState<BlockedDeal[]>([]);
  useEffect(() => {
    fetch("/api/planning/blocked-deals").then((r) => r.ok ? r.json() : []).then(setRows);
  }, []);

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Заблокированные сделки</h1>
      {rows.length === 0 && <p className="text-sm text-slate-500">Заблокированных сделок нет.</p>}
      <div className="flex flex-col gap-3">
        {rows.map(({ deal, blockers }) => (
          <div key={deal.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <Link href={`/planning/deals/${deal.id}`} className="text-lg font-semibold text-blue-600 hover:underline">{deal.title}</Link>
              <div className="text-xs text-slate-500">
                Этап: {deal.stage} · {deal.min_monthly_amount ? `${Number(deal.min_monthly_amount).toLocaleString("ru-RU")} ₽/мес` : "сумма не задана"}
              </div>
            </div>
            <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
              {blockers.map((b) => (
                <li key={b.id}>
                  {b.title} <span className="text-xs text-slate-400">({b.status})</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
