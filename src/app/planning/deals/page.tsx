"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { PlanningDeal, DealStage } from "@/types/planning";

const STAGE_LABEL: Record<DealStage, string> = {
  lead: "Лид",
  pilot: "Пилот",
  production: "Прод",
  churned: "Отвалился",
};
const STAGE_ORDER: DealStage[] = ["lead", "pilot", "production", "churned"];

export default function DealsListPage() {
  const [deals, setDeals] = useState<PlanningDeal[]>([]);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const fetchAll = async () => {
    const res = await fetch("/api/planning/deals");
    if (res.ok) setDeals(await res.json());
  };

  useEffect(() => { fetchAll(); }, []);

  const create = async () => {
    if (!newTitle.trim()) return;
    const res = await fetch("/api/planning/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim() }),
    });
    if (!res.ok) { toast.error("Не удалось создать"); return; }
    setNewTitle(""); setCreating(false); fetchAll();
  };

  const setStage = async (id: string, stage: DealStage) => {
    const res = await fetch(`/api/planning/deals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    if (!res.ok) { toast.error("Не удалось"); return; }
    fetchAll();
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Сделки</h1>
        <button onClick={() => setCreating(true)} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">+ Новая сделка</button>
      </div>

      {creating && (
        <div className="mb-4 flex gap-2">
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Название" className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <button onClick={create} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">Создать</button>
          <button onClick={() => setCreating(false)} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Отмена</button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Название</th>
              <th className="px-3 py-2">Этап</th>
              <th className="px-3 py-2 text-right">Мин. ежемес.</th>
              <th className="px-3 py-2">Сменён</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {deals.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Сделок нет</td></tr>}
            {deals.map((d) => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <Link href={`/planning/deals/${d.id}`} className="text-blue-600 hover:underline">{d.title}</Link>
                </td>
                <td className="px-3 py-2">
                  <select value={d.stage} onChange={(e) => setStage(d.id, e.target.value as DealStage)} className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs">
                    {STAGE_ORDER.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{d.min_monthly_amount ? Number(d.min_monthly_amount).toLocaleString("ru-RU") : "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{new Date(d.stage_changed_at).toLocaleDateString("ru-RU")}</td>
                <td className="px-3 py-2"></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
