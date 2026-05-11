"use client";

import { useEffect, useState } from "react";
import type { Item } from "@/types";
import type { PlanningInitiative, PlanningDeal, ReplanReasonCode } from "@/types/planning";
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

// Concept §3.6 + §6.5. Editable planning fields on a task: initiative, deal, planned_date, why, replan_reason, is_carryover (RO).
export function TaskPlanningSection({ item, layout }: Props) {
  const [initiatives, setInitiatives] = useState<PlanningInitiative[]>([]);
  const [deals, setDeals] = useState<PlanningDeal[]>([]);
  const updateItem = useBrainStore((s) => s.updateItem);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/planning/initiatives").then((r) => r.ok ? r.json() : []),
      fetch("/api/planning/deals").then((r) => r.ok ? r.json() : []),
    ]).then(([inits, dls]) => {
      if (cancelled) return;
      setInitiatives(inits);
      setDeals(dls);
    });
    return () => { cancelled = true; };
  }, []);

  const labelCls = cn("font-medium text-slate-500", layout === "panel" ? "text-xs" : "text-sm");
  const inputCls = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none";

  const reason = item.replan_reason?.code ?? "";

  return (
    <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div>
        <span className={labelCls}>Планирование</span>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-slate-600">Инициатива</label>
        <select
          value={item.initiative_id ?? ""}
          onChange={(e) => updateItem(item.id, { initiative_id: e.target.value || null })}
          className={inputCls}
        >
          <option value="">— не привязана —</option>
          {initiatives.map((i) => (
            <option key={i.id} value={i.id}>{i.title}</option>
          ))}
        </select>
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
              <option key={d.id} value={d.id}>{d.title} · {d.stage}</option>
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
