"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import type { PlanningPeriodRetrospective } from "@/types/planning";

interface Props {
  periodId: string;
  initial: PlanningPeriodRetrospective | null;
  onSaved?: () => void;
}

export function RetrospectiveEditor({ periodId, initial, onSaved }: Props) {
  const [draft, setDraft] = useState<PlanningPeriodRetrospective>({
    what_went_well: "", what_didnt: "", what_to_try: "", lessons_learned: "",
  });

  useEffect(() => { if (initial) setDraft({ ...draft, ...initial }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [initial?.what_went_well, initial?.what_didnt, initial?.what_to_try, initial?.lessons_learned]);

  const save = async () => {
    const res = await fetch(`/api/planning/periods/${periodId}/retrospective`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!res.ok) { toast.error("Не удалось сохранить"); return; }
    toast.success("Ретроспектива сохранена");
    onSaved?.();
  };

  const prefill = async () => {
    const res = await fetch(`/api/planning/periods/${periodId}/retrospective/prefill`, { method: "POST" });
    if (!res.ok) { toast.error("Не удалось сгенерировать черновик"); return; }
    const draftPre = await res.json();
    setDraft((d) => ({ ...d, ...draftPre }));
    toast.success("Черновик заполнен");
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Ретроспектива</h2>
        <div className="flex gap-2">
          <button onClick={prefill} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50">Pre-fill из журнала</button>
          <button onClick={save} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700">Сохранить</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Что хорошо" value={draft.what_went_well ?? ""} onChange={(v) => setDraft((d) => ({ ...d, what_went_well: v }))} />
        <Field label="Что не так" value={draft.what_didnt ?? ""} onChange={(v) => setDraft((d) => ({ ...d, what_didnt: v }))} />
        <Field label="Что попробовать" value={draft.what_to_try ?? ""} onChange={(v) => setDraft((d) => ({ ...d, what_to_try: v }))} />
        <Field label="Уроки" value={draft.lessons_learned ?? ""} onChange={(v) => setDraft((d) => ({ ...d, lessons_learned: v }))} />
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-xs">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
    </label>
  );
}
