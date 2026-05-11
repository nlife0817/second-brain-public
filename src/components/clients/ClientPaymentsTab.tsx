"use client";

// P8: таб «Платежи» в карточке клиента — все платежи по всем сделкам клиента,
// флэт-список с inline-edit. Удобно когда клиент пришёл и хочется глобально
// посмотреть/поправить выручку без открытия отдельных сделок.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import type { ClientDealPayment } from "@/types/planning";

type PaymentWithDeal = ClientDealPayment & { deal_title: string };

interface Props { clientId: string }

export function ClientPaymentsTab({ clientId }: Props) {
  const [items, setItems] = useState<PaymentWithDeal[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/clients/${clientId}/payments`);
    if (res.ok) setItems(await res.json());
    setLoading(false);
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const patchRow = async (payment: PaymentWithDeal, updates: Partial<ClientDealPayment>) => {
    setItems((arr) => arr.map((p) => p.id === payment.id ? { ...p, ...updates } : p));
    const res = await fetch(
      `/api/clients/${clientId}/deals/${payment.deal_id}/payments?payment_id=${payment.id}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) }
    );
    if (!res.ok) { toast.error("Не удалось сохранить"); await load(); }
  };

  const removeRow = async (payment: PaymentWithDeal) => {
    if (!confirm("Удалить платёж?")) return;
    const res = await fetch(
      `/api/clients/${clientId}/deals/${payment.deal_id}/payments?payment_id=${payment.id}`,
      { method: "DELETE" }
    );
    if (!res.ok) { toast.error("Не удалось удалить"); return; }
    setItems((arr) => arr.filter((p) => p.id !== payment.id));
  };

  const totalConfirmed = items.filter((p) => p.status === "confirmed").reduce((s, p) => s + Number(p.amount), 0);
  const totalExpected = items.filter((p) => p.status === "expected").reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Платежи клиента</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-amber-700">
            Ожидаемые: <strong className="tabular-nums">{totalExpected.toLocaleString("ru-RU")} ₽</strong>
          </span>
          <span className="text-emerald-700">
            Подтверждённые: <strong className="tabular-nums">{totalConfirmed.toLocaleString("ru-RU")} ₽</strong>
          </span>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">
          Платежей пока нет. Они появятся автоматически, когда сделка перейдёт в стадию «Пилот» и cron начислит первый ожидаемый платёж.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-2 py-1 text-left">Дата</th>
              <th className="px-2 py-1 text-left">Сделка</th>
              <th className="px-2 py-1 text-right">Сумма, ₽</th>
              <th className="px-2 py-1 text-left">Статус</th>
              <th className="px-2 py-1 text-left">Заметка</th>
              <th className="w-8 px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-b border-slate-100">
                <td className="px-2 py-1">
                  <input
                    type="date"
                    defaultValue={p.paid_at.slice(0, 10)}
                    onBlur={(e) => { if (e.target.value && e.target.value !== p.paid_at.slice(0, 10)) patchRow(p, { paid_at: e.target.value }); }}
                    className="rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                  />
                </td>
                <td className="px-2 py-1 text-xs text-slate-600 truncate" title={p.deal_title}>
                  {p.deal_title || "—"}
                </td>
                <td className="px-2 py-1 text-right">
                  <input
                    type="number"
                    step="any"
                    defaultValue={p.amount}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== Number(p.amount)) patchRow(p, { amount: v });
                    }}
                    className="w-28 rounded border border-slate-200 px-1 py-0.5 text-right text-[11px] tabular-nums"
                  />
                </td>
                <td className="px-2 py-1">
                  <button
                    type="button"
                    onClick={() => patchRow(p, { status: p.status === "expected" ? "confirmed" : "expected" })}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      p.status === "confirmed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {p.status}
                  </button>
                </td>
                <td className="px-2 py-1">
                  <input
                    defaultValue={p.note ?? ""}
                    onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (p.note ?? null)) patchRow(p, { note: v }); }}
                    className="w-full rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                  />
                </td>
                <td className="px-2 py-1">
                  <button
                    type="button"
                    onClick={() => removeRow(p)}
                    className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    title="Удалить"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
