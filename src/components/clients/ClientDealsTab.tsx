"use client";

// P8: таб «Сделки» внутри карточки клиента. Аккордеон-список сделок
// клиента с inline-edit (title, status_id, pilot/prod таймстемпы, MRR,
// expected_actual_amount, description). Платежи каждой сделки —
// раскрываемый блок внутри той же аккордеон-секции.
//
// Триггер lifecycle (pilot_started_at, pilot_planned_end_at,
// production_started_at) — на бэке в updateClientDeal.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { ClientDeal, ClientDealPayment, DealPaymentStatus } from "@/types/planning";
import { useBrainStore } from "@/lib/store";

interface Props { clientId: string }

export function ClientDealsTab({ clientId }: Props) {
  const clientStatuses = useBrainStore((s) => s.clientStatuses);
  const [deals, setDeals] = useState<ClientDeal[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/clients/${clientId}/deals`);
    if (res.ok) setDeals(await res.json());
    setLoading(false);
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const createDeal = async () => {
    setCreating(true);
    const res = await fetch(`/api/clients/${clientId}/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Новая сделка" }),
    });
    setCreating(false);
    if (!res.ok) { toast.error("Не удалось создать сделку"); return; }
    const row: ClientDeal = await res.json();
    setDeals((d) => [...d, row]);
    setExpanded((e) => new Set(e).add(row.id));
  };

  const patchDeal = async (dealId: string, updates: Partial<ClientDeal>) => {
    // Optimistic.
    setDeals((d) => d.map((x) => x.id === dealId ? { ...x, ...updates } : x));
    const res = await fetch(`/api/clients/${clientId}/deals/${dealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) { toast.error("Не удалось сохранить"); await load(); return; }
    const fresh: ClientDeal = await res.json();
    setDeals((d) => d.map((x) => x.id === dealId ? fresh : x));
  };

  const deleteDeal = async (dealId: string) => {
    if (!confirm("Удалить сделку и все её платежи?")) return;
    const res = await fetch(`/api/clients/${clientId}/deals/${dealId}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Не удалось удалить"); return; }
    setDeals((d) => d.filter((x) => x.id !== dealId));
  };

  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Сделки клиента</h3>
        <button
          type="button"
          onClick={createDeal}
          disabled={creating}
          className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus className="size-3.5" /> Новая сделка
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Загрузка…</p>
      ) : deals.length === 0 ? (
        <p className="text-sm text-slate-500">
          Сделок ещё нет. Создайте первую — задайте статус «Пилот», чтобы запустить ежемесячные ожидаемые платежи.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {deals.map((d) => (
            <DealRow
              key={d.id}
              clientId={clientId}
              deal={d}
              expanded={expanded.has(d.id)}
              onToggle={() => setExpanded((e) => {
                const next = new Set(e);
                if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                return next;
              })}
              onPatch={(updates) => patchDeal(d.id, updates)}
              onDelete={() => deleteDeal(d.id)}
              statusOptions={clientStatuses}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DealRow({
  clientId, deal, expanded, onToggle, onPatch, onDelete, statusOptions,
}: {
  clientId: string;
  deal: ClientDeal;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (updates: Partial<ClientDeal>) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  statusOptions: Array<{ id: string; name: string; color: string }>;
}) {
  const status = statusOptions.find((s) => s.id === deal.status_id);
  return (
    <li className="rounded-lg border border-slate-200 bg-white">
      {/* Header — clickable to expand */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
      >
        {expanded ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
        <span className="flex-1 truncate text-sm font-medium">{deal.title || "Без названия"}</span>
        {status && (
          <span
            className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: `${status.color}22`, color: status.color }}
          >
            {status.name}
          </span>
        )}
        {deal.min_monthly_amount != null && (
          <span className="text-[11px] tabular-nums text-slate-500">
            {Number(deal.min_monthly_amount).toLocaleString("ru-RU")} ₽/мес
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-slate-100 px-3 py-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-slate-500">Название</span>
              <input
                defaultValue={deal.title}
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== deal.title) onPatch({ title: v }); }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Статус</span>
              <select
                value={deal.status_id ?? ""}
                onChange={(e) => onPatch({ status_id: e.target.value || null })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="">— без статуса —</option>
                {statusOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Старт пилота</span>
              <input
                type="datetime-local"
                defaultValue={deal.pilot_started_at ? toLocalInput(deal.pilot_started_at) : ""}
                onBlur={(e) => onPatch({ pilot_started_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Окончание пилота (план)</span>
              <input
                type="datetime-local"
                defaultValue={deal.pilot_planned_end_at ? toLocalInput(deal.pilot_planned_end_at) : ""}
                onBlur={(e) => onPatch({ pilot_planned_end_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Старт прода</span>
              <input
                type="datetime-local"
                defaultValue={deal.production_started_at ? toLocalInput(deal.production_started_at) : ""}
                onBlur={(e) => onPatch({ production_started_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Длительность пилота, дней</span>
              <input
                type="number"
                min={1}
                defaultValue={deal.pilot_default_duration_days}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v !== deal.pilot_default_duration_days) onPatch({ pilot_default_duration_days: v });
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Мин. платёж в месяц, ₽</span>
              <input
                type="number"
                step="any"
                defaultValue={deal.min_monthly_amount ?? ""}
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== deal.min_monthly_amount) onPatch({ min_monthly_amount: v });
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Ожидаемая факт. сумма, ₽</span>
              <input
                type="number"
                step="any"
                defaultValue={deal.expected_actual_amount ?? ""}
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== deal.expected_actual_amount) onPatch({ expected_actual_amount: v });
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-slate-500">Описание</span>
            <textarea
              defaultValue={deal.description ?? ""}
              rows={2}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== (deal.description ?? null)) onPatch({ description: v });
              }}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>

          <DealPayments clientId={clientId} dealId={deal.id} />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-700 hover:bg-red-100"
            >
              <Trash2 className="size-3.5" /> Удалить сделку
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function DealPayments({ clientId, dealId }: { clientId: string; dealId: string }) {
  const [items, setItems] = useState<ClientDealPayment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/clients/${clientId}/deals/${dealId}/payments`);
    if (res.ok) setItems(await res.json());
    setLoading(false);
  }, [clientId, dealId]);

  useEffect(() => { void load(); }, [load]);

  const addRow = async () => {
    const res = await fetch(`/api/clients/${clientId}/deals/${dealId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paid_at: new Date().toISOString().slice(0, 10),
        amount: 0,
        status: "expected" as DealPaymentStatus,
      }),
    });
    if (!res.ok) { toast.error("Не удалось добавить платёж"); return; }
    await load();
  };

  const patchRow = async (paymentId: string, updates: Partial<ClientDealPayment>) => {
    setItems((it) => it.map((p) => p.id === paymentId ? { ...p, ...updates } : p));
    const res = await fetch(`/api/clients/${clientId}/deals/${dealId}/payments?payment_id=${paymentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) { toast.error("Не удалось сохранить"); await load(); }
  };

  const removeRow = async (paymentId: string) => {
    if (!confirm("Удалить платёж?")) return;
    const res = await fetch(`/api/clients/${clientId}/deals/${dealId}/payments?payment_id=${paymentId}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Не удалось удалить"); return; }
    setItems((it) => it.filter((p) => p.id !== paymentId));
  };

  return (
    <div className="rounded-md border border-slate-100 bg-slate-50/40 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600">Платежи ({items.length})</span>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100"
        >
          <Plus className="size-3" /> Добавить
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-slate-400">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-400">Платежей нет. Cron «recurring-payments» создаст ожидаемый платёж за месяц автоматически, как только задан старт пилота.</p>
      ) : (
        <ul className="grid gap-1">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-xs">
              <input
                type="date"
                defaultValue={p.paid_at.slice(0, 10)}
                onBlur={(e) => { if (e.target.value && e.target.value !== p.paid_at.slice(0, 10)) patchRow(p.id, { paid_at: e.target.value }); }}
                className="rounded border border-slate-200 px-1 py-0.5 text-[11px]"
              />
              <input
                type="number"
                step="any"
                defaultValue={p.amount}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v !== Number(p.amount)) patchRow(p.id, { amount: v });
                }}
                className="w-28 rounded border border-slate-200 px-1 py-0.5 text-[11px] tabular-nums"
              />
              <button
                type="button"
                onClick={() => patchRow(p.id, { status: p.status === "expected" ? "confirmed" : "expected" })}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  p.status === "confirmed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                }`}
                title="Переключить статус"
              >
                {p.status === "confirmed" ? "confirmed" : "expected"}
              </button>
              <input
                defaultValue={p.note ?? ""}
                onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (p.note ?? null)) patchRow(p.id, { note: v }); }}
                placeholder="Заметка"
                className="flex-1 rounded border border-slate-200 px-1 py-0.5 text-[11px]"
              />
              <button
                type="button"
                onClick={() => removeRow(p.id)}
                className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                title="Удалить"
              >
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function toLocalInput(iso: string): string {
  // datetime-local нужен формат YYYY-MM-DDTHH:mm (без TZ).
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
