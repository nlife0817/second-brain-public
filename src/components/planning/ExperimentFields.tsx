"use client";

import type { ExperimentDecision } from "@/types/planning";
import { experimentDecisionTone, SEMANTIC_CLASS } from "@/lib/planning-colors";

interface Props {
  hypothesis: string | null;
  successCriteria: string | null;
  killCriteria: string | null;
  sampleSizeOrDuration: string | null;
  experimentResult: string | null;
  experimentDecision: ExperimentDecision | null;
  onChange: (patch: {
    hypothesis?: string | null;
    success_criteria?: string | null;
    kill_criteria?: string | null;
    sample_size_or_duration?: string | null;
    experiment_result?: string | null;
    experiment_decision?: ExperimentDecision | null;
  }) => void;
}

const DECISION_OPTIONS: Array<{ value: ExperimentDecision; label: string }> = [
  { value: "validated",    label: "Подтверждён" },
  { value: "invalidated",  label: "Опровергнут" },
  { value: "inconclusive", label: "Неубедительно" },
];

// Concept §3.4.2.
export function ExperimentFields({
  hypothesis, successCriteria, killCriteria, sampleSizeOrDuration, experimentResult, experimentDecision, onChange,
}: Props) {
  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/30 p-3">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-purple-700">Эксперимент</h3>
      <div className="grid gap-3 text-sm">
        <Field label="Гипотеза *" placeholder="Если X, то Y увеличится на Z%, потому что…" value={hypothesis} onChange={(v) => onChange({ hypothesis: v })} />
        <Field label="Критерий успеха *" placeholder="Что считаем успехом численно" value={successCriteria} onChange={(v) => onChange({ success_criteria: v })} />
        <Field label="Kill criteria *" placeholder="При каком результате убиваем" value={killCriteria} onChange={(v) => onChange({ kill_criteria: v })} />
        <Field label="Выборка / длительность" placeholder="Например, 100 клиентов или 2 недели" value={sampleSizeOrDuration} onChange={(v) => onChange({ sample_size_or_duration: v })} singleLine />
        <Field label="Результат" placeholder="Заполняется при завершении" value={experimentResult} onChange={(v) => onChange({ experiment_result: v })} />

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Решение</label>
          <div className="flex flex-wrap gap-1">
            {DECISION_OPTIONS.map((opt) => {
              const active = experimentDecision === opt.value;
              const tone = experimentDecisionTone(opt.value);
              const c = SEMANTIC_CLASS[tone];
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ experiment_decision: active ? null : opt.value })}
                  className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                    active ? `${c.bg} ${c.text} ${c.border} font-semibold` : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, placeholder, value, onChange, singleLine }: {
  label: string; placeholder?: string; value: string | null; onChange: (v: string | null) => void; singleLine?: boolean;
}) {
  if (singleLine) {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700">{label}</label>
        <input
          defaultValue={value ?? ""}
          placeholder={placeholder}
          onBlur={(e) => onChange(e.target.value.trim() || null)}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>
    );
  }
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700">{label}</label>
      <textarea
        defaultValue={value ?? ""}
        placeholder={placeholder}
        rows={2}
        onBlur={(e) => onChange(e.target.value.trim() || null)}
        className="w-full resize-y rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
      />
    </div>
  );
}
