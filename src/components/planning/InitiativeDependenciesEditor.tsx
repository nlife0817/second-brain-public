"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import type { PlanningInitiative, PlanningInitiativeDependency } from "@/types/planning";

interface Props {
  initiativeId: string;
  dependencies: PlanningInitiativeDependency[];
  allInitiatives: PlanningInitiative[];
  onChange: () => void;
}

// Concept §3.5. Edits planning_initiative_dependency via /api/planning/initiatives/[id]/dependencies.
export function InitiativeDependenciesEditor({ initiativeId, dependencies, allInitiatives, onChange }: Props) {
  const [picking, setPicking] = useState("");
  const depIds = new Set(dependencies.map((d) => d.depends_on_initiative_id));
  const candidates = allInitiatives.filter((i) => i.id !== initiativeId && !depIds.has(i.id));
  const idToTitle = new Map(allInitiatives.map((i) => [i.id, i.title]));

  const addDep = async (depId: string) => {
    const res = await fetch(`/api/planning/initiatives/${initiativeId}/dependencies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ depends_on_initiative_id: depId }),
    });
    if (!res.ok) { toast.error("Не удалось добавить"); return; }
    setPicking("");
    onChange();
  };

  const removeDep = async (depId: string) => {
    const res = await fetch(`/api/planning/initiatives/${initiativeId}/dependencies`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ depends_on_initiative_id: depId }),
    });
    if (!res.ok) { toast.error("Не удалось удалить"); return; }
    onChange();
  };

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Зависимости</h3>
      <p className="mb-2 text-[11px] text-slate-500">Эта инициатива требует завершения:</p>

      <ul className="mb-2 flex flex-col gap-1 text-sm">
        {dependencies.length === 0 && <li className="text-xs text-slate-400">Зависимостей нет</li>}
        {dependencies.map((d) => (
          <li key={d.depends_on_initiative_id} className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-1">
            <span className="truncate">{idToTitle.get(d.depends_on_initiative_id) ?? d.depends_on_initiative_id}</span>
            <button
              type="button"
              onClick={() => removeDep(d.depends_on_initiative_id)}
              className="ml-2 rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              title="Убрать зависимость"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <select
        value={picking}
        onChange={(e) => {
          const v = e.target.value;
          setPicking(v);
          if (v) addDep(v);
        }}
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
      >
        <option value="">+ Добавить зависимость…</option>
        {candidates.map((i) => (
          <option key={i.id} value={i.id}>{i.title}</option>
        ))}
      </select>
    </div>
  );
}
