"use client";

import { useEffect, useState } from "react";
import type { PlanningChangeLogEntry } from "@/types/planning";

export default function ChangelogPage() {
  const [items, setItems] = useState<PlanningChangeLogEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [entityType, setEntityType] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchPage = async (start = 0, replace = false) => {
    const qs = new URLSearchParams();
    qs.set("limit", "100");
    qs.set("offset", String(start));
    if (entityType) qs.set("entity_type", entityType);
    const res = await fetch(`/api/planning/changelog?${qs}`);
    if (!res.ok) return;
    const page: PlanningChangeLogEntry[] = await res.json();
    setHasMore(page.length === 100);
    setItems(replace ? page : [...items, ...page]);
    setOffset(start + page.length);
  };

  useEffect(() => { setItems([]); setOffset(0); fetchPage(0, true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [entityType]);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Журнал изменений</h1>
        <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">Все типы</option>
          <option value="direction">Направление</option>
          <option value="metric">Метрика</option>
          <option value="initiative">Инициатива</option>
          <option value="deal">Сделка</option>
          <option value="deal_payment">Платёж</option>
          <option value="metric_target">Цель метрики</option>
          <option value="period">Период</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Когда</th>
              <th className="px-3 py-2">Кто</th>
              <th className="px-3 py-2">Тип</th>
              <th className="px-3 py-2">Действие</th>
              <th className="px-3 py-2">Причина</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">Записей нет</td></tr>}
            {items.map((it) => (
              <>
                <tr key={it.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setExpanded(expanded === it.id ? null : it.id)}>
                  <td className="px-3 py-1.5 text-xs text-slate-500">{new Date(it.timestamp).toLocaleString("ru-RU")}</td>
                  <td className="px-3 py-1.5 text-xs">{it.actor_email ?? "—"}</td>
                  <td className="px-3 py-1.5 text-xs">{it.entity_type}</td>
                  <td className="px-3 py-1.5 text-xs">{it.action}</td>
                  <td className="px-3 py-1.5 text-xs">{it.replan_reason ? (it.replan_reason as { code?: string }).code ?? "—" : "—"}</td>
                </tr>
                {expanded === it.id && (
                  <tr key={`${it.id}-diff`} className="border-t border-slate-100 bg-slate-50">
                    <td colSpan={5} className="px-3 py-2">
                      <pre className="overflow-x-auto rounded-md bg-white p-2 text-[11px] text-slate-700">{JSON.stringify({ diff: it.diff, context: it.context, replan_reason: it.replan_reason }, null, 2)}</pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="mt-4 text-center">
          <button onClick={() => fetchPage(offset)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">Загрузить ещё</button>
        </div>
      )}
    </div>
  );
}
