"use client";

import { useEffect, useState, useMemo } from "react";
import { Check, X as XIcon } from "lucide-react";
import type { Item } from "@/types";
import type { PlanningInitiative, ClientDeal, ReplanReasonCode } from "@/types/planning";
import { useBrainStore } from "@/lib/store";
import { cn } from "@/lib/utils";

interface Props {
  item: Item;
  layout: "modal" | "panel";
}

const REPLAN_OPTIONS: Array<{ value: ReplanReasonCode; label: string }> = [
  { value: "customer_signal_changed", label: "Сигнал клиентов изменился" },
  { value: "discovery_invalidated",   label: "Гипотеза опровергнута" },
  { value: "dependency_shifted",      label: "Зависимость сдвинулась" },
  { value: "scope_underestimated",    label: "Объём недооценён" },
  { value: "scope_overestimated",     label: "Объём переоценён" },
  { value: "priority_changed",        label: "Приоритет изменился" },
  { value: "external_event",          label: "Внешнее событие" },
  { value: "kill_criteria_triggered", label: "Сработал kill criteria" },
  { value: "minor_adjustment",        label: "Минорная правка" },
];

type DealWithContext = ClientDeal & { client_name: string; status_name: string | null };

export function TaskPlanningSection({ item, layout }: Props) {
  const [initiatives, setInitiatives] = useState<PlanningInitiative[]>([]);
  const [deals, setDeals] = useState<DealWithContext[]>([]);
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const updateItem = useBrainStore((s) => s.updateItem);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/planning/initiatives").then((r) => r.ok ? r.json() : []),
      fetch("/api/clients/deals").then((r) => r.ok ? r.json() : []),
      fetch(`/api/planning/items/${item.id}/initiatives`).then((r) => r.ok ? r.json() : []),
    ]).then(([inits, dls, links]: [PlanningInitiative[], DealWithContext[], string[]]) => {
      if (cancelled) return;
      setInitiatives(inits);
      setDeals(dls);
      setLinkedIds(new Set(links));
    });
    return () => { cancelled = true; };
  }, [item.id]);

  const labelCls = cn("font-medium text-slate-500", layout === "panel" ? "text-xs" : "text-sm");
  const inputCls = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none";

  const reason = item.replan_reason?.code ?? "";

  const linkedInitiatives = useMemo(
    () => initiatives.filter((i) => linkedIds.has(i.id)),
    [initiatives, linkedIds]
  );
  const pickerCandidates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return initiatives.filter((i) => {
      if (linkedIds.has(i.id)) return false;
      if (!q) return true;
      return i.title.toLowerCase().includes(q);
    });
  }, [initiatives, linkedIds, pickerQuery]);

  const toggleInitiative = async (initiativeId: string) => {
    const wasLinked = linkedIds.has(initiativeId);
    // Optimistic
    setLinkedIds((prev) => {
      const next = new Set(prev);
      if (wasLinked) next.delete(initiativeId); else next.add(initiativeId);
      return next;
    });
    try {
      if (wasLinked) {
        await fetch(
          `/api/planning/items/${item.id}/initiatives?initiative_id=${encodeURIComponent(initiativeId)}`,
          { method: "DELETE" }
        );
      } else {
        await fetch(`/api/planning/items/${item.id}/initiatives`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initiative_id: initiativeId }),
        });
      }
    } catch {
      // Rollback on error
      setLinkedIds((prev) => {
        const next = new Set(prev);
        if (wasLinked) next.add(initiativeId); else next.delete(initiativeId);
        return next;
      });
    }
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div>
        <span className={labelCls}>Планирование</span>
      </div>

      {/* M:N привязки к инициативам (P3 + UI rework) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium text-slate-600">
            Инициативы
            {linkedInitiatives.length > 0 && (
              <span className="ml-1 text-slate-400 tabular-nums">
                · {linkedInitiatives.length}
              </span>
            )}
          </label>
          <button
            type="button"
            onClick={() => { setPicker((v) => !v); setPickerQuery(""); }}
            className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
          >
            {picker ? "Скрыть" : "+ Привязать"}
          </button>
        </div>

        {linkedInitiatives.length === 0 ? (
          <p className="text-[11px] text-slate-400">Задача ни к одной инициативе не привязана.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {linkedInitiatives.map((i) => (
              <span
                key={i.id}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700"
              >
                <span className="max-w-[180px] truncate" title={i.title}>{i.title}</span>
                <button
                  type="button"
                  onClick={() => toggleInitiative(i.id)}
                  className="text-slate-400 hover:text-red-600"
                  title="Отвязать"
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {picker && (
          <div className="mt-1 rounded-md border border-slate-200 bg-white">
            <input
              autoFocus
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Поиск инициативы…"
              className="w-full rounded-t-md border-b border-slate-100 px-2 py-1.5 text-xs focus:outline-none"
            />
            <div className="max-h-44 overflow-y-auto">
              {pickerCandidates.length === 0 ? (
                <p className="px-2 py-2 text-xs text-slate-400">
                  {pickerQuery ? "Ничего не найдено" : "Все инициативы уже привязаны"}
                </p>
              ) : (
                pickerCandidates.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => toggleInitiative(i.id)}
                    className="flex w-full items-center gap-2 border-b border-slate-50 px-2 py-1.5 text-left text-xs last:border-b-0 hover:bg-slate-50"
                  >
                    <Check className="size-3 text-slate-300" />
                    <span className="min-w-0 flex-1 truncate" title={i.title}>{i.title}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {(item.category === "sales" || item.category === "account" || item.linked_deal_id) && (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-600">Сделка</label>
          <select
            value={item.linked_deal_id ?? ""}
            onChange={(e) => updateItem(item.id, { linked_deal_id: e.target.value || null })}
            className={inputCls}
          >
            <option value="">— не выбрана —</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.client_name} — {d.title || "сделка"}
                {d.status_name ? ` · ${d.status_name}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-600">Плановая дата</label>
          <input
            type="date"
            defaultValue={item.planned_date ?? ""}
            onBlur={(e) => {
              const v = e.target.value || null;
              if (v !== (item.planned_date ?? null)) updateItem(item.id, { planned_date: v });
            }}
            className={inputCls}
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-600">Перенос</label>
          <div className="flex h-[34px] items-center px-1">
            {item.is_carryover ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">Перенос</span>
            ) : (
              <span className="text-xs text-slate-400">—</span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-slate-600">Почему важна</label>
        <input
          defaultValue={item.why ?? ""}
          onBlur={(e) => {
            const v = e.target.value.trim() || null;
            if (v !== (item.why ?? null)) updateItem(item.id, { why: v });
          }}
          placeholder="Короткое обоснование"
          className={inputCls}
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-slate-600">Причина переплана</label>
        <select
          value={reason}
          onChange={(e) => {
            const code = e.target.value as ReplanReasonCode | "";
            updateItem(item.id, { replan_reason: code ? { code } : null });
          }}
          className={inputCls}
        >
          <option value="">— нет —</option>
          {REPLAN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
}
