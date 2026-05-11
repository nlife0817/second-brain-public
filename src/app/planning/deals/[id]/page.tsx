"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import type { PlanningDeal, PlanningDealPayment, DealStage } from "@/types/planning";

const STAGE_LABEL: Record<DealStage, string> = {
  lead: "Лид", pilot: "Пилот", production: "Прод", churned: "Отвалился",
};

export default function DealDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [deal, setDeal] = useState<PlanningDeal | null>(null);
  const [payments, setPayments] = useState<PlanningDealPayment[]>([]);
  const [paidAt, setPaidAt] = useState("");
  const [amount, setAmount] = useState("");

  const fetchAll = async () => {
    const [d, p] = await Promise.all([
      fetch(`/api/planning/deals/${id}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/planning/deals/${id}/payments`).then((r) => r.ok ? r.json() : []),
    ]);
    setDeal(d); setPayments(p);
  };

  useEffect(() => { fetchAll(); }, [id]);

  const addPayment = async () => {
    if (!paidAt || !amount) return;
    const res = await fetch(`/api/planning/deals/${id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paid_at: paidAt, amount: Number(amount), status: "confirmed" }),
    });
    if (!res.ok) { toast.error("Не удалось"); return; }
    setPaidAt(""); setAmount(""); fetchAll();
  };

  const updateMin = async (v: number) => {
    const res = await fetch(`/api/planning/deals/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ min_monthly_amount: v }),
    });
    if (!res.ok) { toast.error("Не удалось"); return; }
    fetchAll();
  };

  const togglePaymentStatus = async (paymentId: string, current: "expected" | "confirmed") => {
    const next = current === "expected" ? "confirmed" : "expected";
    const res = await fetch(`/api/planning/deals/${id}/payments`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: paymentId, status: next }),
    });
    if (!res.ok) { toast.error("Не удалось"); return; }
    fetchAll();
  };

  const updatePaymentAmount = async (paymentId: string, amount: number) => {
    const res = await fetch(`/api/planning/deals/${id}/payments`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: paymentId, amount }),
    });
    if (!res.ok) { toast.error("Не удалось"); return; }
    fetchAll();
  };

  const deletePayment = async (paymentId: string) => {
    if (!confirm("Удалить платёж?")) return;
    const res = await fetch(`/api/planning/deals/${id}/payments`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: paymentId }),
    });
    if (!res.ok) { toast.error("Не удалось"); return; }
    fetchAll();
  };

  if (!deal) return <div className="p-6 text-sm text-slate-500">Загрузка…</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">{deal.title}</h1>
      <p className="mt-1 text-sm text-slate-500">Этап: {STAGE_LABEL[deal.stage]} · сменён {new Date(deal.stage_changed_at).toLocaleDateString("ru-RU")}</p>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Мин. ежемесячный</p>
          <input
            type="number"
            defaultValue={deal.min_monthly_amount ?? 0}
            onBlur={(e) => updateMin(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-2xl font-bold"
          />
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Пилот: {deal.pilot_started_at?.slice(0, 10) ?? "—"} → {deal.pilot_planned_end_at?.slice(0, 10) ?? "—"}</p>
          <p className="text-xs text-slate-500">Прод: {deal.production_started_at?.slice(0, 10) ?? "—"}</p>
        </div>
      </div>

      <h2 className="mt-6 text-sm font-semibold">Платежи</h2>
      <div className="mt-2 flex gap-2">
        <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <input type="number" placeholder="Сумма" value={amount} onChange={(e) => setAmount(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <button onClick={addPayment} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">+ Платёж (подтверждённый)</button>
      </div>
      <div className="mt-2 overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Дата</th>
              <th className="px-3 py-2 text-right">Сумма</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">Платежей нет</td></tr>}
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{p.paid_at}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <input
                    type="number"
                    defaultValue={Number(p.amount)}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== Number(p.amount)) {
                        void updatePaymentAmount(p.id, v);
                      }
                    }}
                    className="w-32 rounded-md border border-transparent px-1 py-0.5 text-right hover:border-slate-300 focus:border-slate-300"
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => togglePaymentStatus(p.id, p.status)}
                    className={`rounded-md px-2 py-0.5 text-xs ${
                      p.status === "confirmed"
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                    }`}
                    title={p.status === "confirmed"
                      ? "Кликните чтобы вернуть в «ожидается»"
                      : "Кликните чтобы подтвердить"}
                  >
                    {p.status === "confirmed" ? "Подтверждён" : "Ожидается"}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => deletePayment(p.id)}
                    className="rounded-md px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
