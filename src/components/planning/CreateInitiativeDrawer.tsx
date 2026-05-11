"use client";

import { useState } from "react";
import { usePlanningStore } from "@/lib/planning-store";
import type { InitiativeType } from "@/types/planning";

interface Props { open: boolean; onClose: () => void; }

const TYPES: Array<{ value: InitiativeType; label: string }> = [
  { value: "client_blocker", label: "Блокер клиента" },
  { value: "product_maturity", label: "Развитие продукта" },
  { value: "tech_debt", label: "Тех. долг" },
  { value: "experiment", label: "Эксперимент" },
  { value: "support", label: "Поддержка" },
];

export function CreateInitiativeDrawer({ open, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<InitiativeType>("product_maturity");
  const selectedMetricId = usePlanningStore((s) => s.selectedMetricId);
  const createInitiative = usePlanningStore((s) => s.createInitiative);

  if (!open) return null;

  const submit = async () => {
    if (!title.trim()) return;
    await createInitiative({
      title: title.trim(),
      type,
      linked_metric_ids: selectedMetricId ? [selectedMetricId] : [],
    });
    setTitle(""); onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="flex w-[420px] flex-col gap-3 bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold">Новая инициатива</h2>
        <label className="text-sm">
          Название
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-sm">
          Тип
          <select value={type} onChange={(e) => setType(e.target.value as InitiativeType)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        {selectedMetricId && (
          <p className="text-xs text-slate-500">
            Привязка к выбранной метрике добавляется автоматически.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Отмена</button>
          <button onClick={submit} disabled={!title.trim()} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">Создать</button>
        </div>
      </div>
    </div>
  );
}
