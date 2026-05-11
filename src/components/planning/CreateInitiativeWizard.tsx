"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, X, Check } from "lucide-react";
import { toast } from "sonner";
import { usePlanningStore } from "@/lib/planning-store";
import type { InitiativeType, PlanningPeriod } from "@/types/planning";
import { JTBD_HINT_BY_TYPE, INITIATIVE_TYPE_DESCRIPTION } from "@/lib/planning-initiative-meta";
import { WeekGridPicker } from "./WeekGridPicker";

interface Props { open: boolean; onClose: () => void; }

const TYPES: Array<{ value: InitiativeType; label: string; description: string }> = [
  { value: "client_blocker",   label: "Блокер клиента",   description: INITIATIVE_TYPE_DESCRIPTION.client_blocker },
  { value: "product_maturity", label: "Развитие продукта", description: INITIATIVE_TYPE_DESCRIPTION.product_maturity },
  { value: "tech_debt",        label: "Тех. долг",         description: INITIATIVE_TYPE_DESCRIPTION.tech_debt },
  { value: "experiment",       label: "Эксперимент",       description: INITIATIVE_TYPE_DESCRIPTION.experiment },
  { value: "support",          label: "Поддержка",         description: INITIATIVE_TYPE_DESCRIPTION.support },
];

type Step = 1 | 2 | 3 | 4;

interface FormState {
  type: InitiativeType;
  title: string;
  description: string;
  start_period_id: string | null;
  end_period_id: string | null;
  estimate_hours: string;
  jtbd: string;
  hypothesis: string;
  success_criteria: string;
  kill_criteria: string;
  sample_size_or_duration: string;
  linked_metric_ids: string[];
}

const INITIAL: FormState = {
  type: "product_maturity",
  title: "",
  description: "",
  start_period_id: null,
  end_period_id: null,
  estimate_hours: "",
  jtbd: "",
  hypothesis: "",
  success_criteria: "",
  kill_criteria: "",
  sample_size_or_duration: "",
  linked_metric_ids: [],
};

// CreateInitiativeWizard — 4-step modal-master.
//
// Steps:
//   1. Тип (chip + описание + inline-hint на следующем шаге)
//   2. Базовые поля: title / description / week range / estimate
//   3. JTBD (blocker/maturity) или Эксперимент-поля (experiment)
//   4. Связи: метрики (multi); сделки и клиенты — в drawer'е после создания
export function CreateInitiativeWizard({ open, onClose }: Props) {
  const periods = usePlanningStore((s) => s.periods);
  const metrics = usePlanningStore((s) => s.metrics);
  const selectedMetricId = usePlanningStore((s) => s.selectedMetricId);
  const directionId = usePlanningStore((s) => s.selectedDirectionId);
  const refresh = usePlanningStore((s) => s.fetchAll);

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(() => ({
    ...INITIAL,
    linked_metric_ids: selectedMetricId ? [selectedMetricId] : [],
  }));
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const reset = () => { setForm({ ...INITIAL, linked_metric_ids: selectedMetricId ? [selectedMetricId] : [] }); setStep(1); };
  const close = () => { reset(); onClose(); };

  const hasJtbdStep = form.type === "client_blocker" || form.type === "product_maturity";
  const hasExperimentStep = form.type === "experiment";
  const skipStep3 = !hasJtbdStep && !hasExperimentStep;

  const validateStep = (s: Step): string | null => {
    if (s === 2) {
      if (!form.title.trim()) return "Название обязательно";
    }
    if (s === 3) {
      if (hasJtbdStep && !form.jtbd.trim()) return "JTBD обязателен для блокеров и развития продукта";
      if (hasExperimentStep) {
        if (!form.hypothesis.trim()) return "Гипотеза обязательна";
        if (!form.success_criteria.trim()) return "Критерий успеха обязателен";
        if (!form.kill_criteria.trim()) return "Kill criteria обязательны";
      }
    }
    return null;
  };

  const next = () => {
    const err = validateStep(step);
    if (err) { toast.error(err); return; }
    if (step === 2 && skipStep3) setStep(4);
    else setStep((s) => (s < 4 ? ((s + 1) as Step) : s));
  };
  const prev = () => {
    if (step === 4 && skipStep3) setStep(2);
    else setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
  };

  const submit = async () => {
    // Validate all remaining steps in sequence.
    for (const s of [2, 3] as Step[]) {
      const err = validateStep(s);
      if (err) { toast.error(err); setStep(s); return; }
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        direction_id: directionId,
        title: form.title.trim(),
        type: form.type,
        description: form.description.trim() || null,
        linked_metric_ids: form.linked_metric_ids,
      };
      if (form.start_period_id) body.start_period_id = form.start_period_id;
      if (form.end_period_id) body.end_period_id = form.end_period_id;
      if (form.estimate_hours) {
        const n = Number(form.estimate_hours);
        if (Number.isFinite(n) && n >= 0) body.estimate_hours = n;
      }
      if (hasJtbdStep) body.jtbd = form.jtbd.trim();
      if (hasExperimentStep) {
        body.hypothesis = form.hypothesis.trim();
        body.success_criteria = form.success_criteria.trim();
        body.kill_criteria = form.kill_criteria.trim();
        if (form.sample_size_or_duration.trim()) body.sample_size_or_duration = form.sample_size_or_duration.trim();
      }
      const res = await fetch("/api/planning/initiatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        toast.error(`Не удалось создать: ${t.slice(0, 120)}`);
        return;
      }
      const created = await res.json();
      toast.success("Инициатива создана");
      await refresh();
      usePlanningStore.setState({ selectedInitiativeId: created.id, detailInitiativeId: created.id });
      close();
    } finally {
      setBusy(false);
    }
  };

  const totalSteps = skipStep3 ? 3 : 4;
  const displayStep = step <= 2 ? step : (skipStep3 ? (step === 4 ? 3 : step) : step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-[640px] flex-col rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-lg font-semibold">Новая инициатива</h2>
            <p className="text-xs text-slate-500">Шаг {displayStep} из {totalSteps}</p>
          </div>
          <button onClick={close} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="size-5" />
          </button>
        </header>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 1 && <Step1 form={form} setForm={setForm} />}
          {step === 2 && <Step2 form={form} setForm={setForm} periods={periods} />}
          {step === 3 && (hasJtbdStep ? <Step3Jtbd form={form} setForm={setForm} />
            : hasExperimentStep ? <Step3Experiment form={form} setForm={setForm} /> : null)}
          {step === 4 && <Step4 form={form} setForm={setForm} metrics={metrics} />}
        </div>

        {/* Footer nav */}
        <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            onClick={prev}
            disabled={step === 1}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            <ArrowLeft className="size-4" /> Назад
          </button>
          {step < 4 ? (
            <button
              onClick={next}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              Дальше <ArrowRight className="size-4" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={busy || !form.title.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Check className="size-4" /> Создать
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ─────────────────────── Step 1: Type ─────────────────────────────────────

function Step1({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  return (
    <div className="grid gap-2">
      <p className="mb-2 text-sm text-slate-600">Выберите тип инициативы. Поля на следующих шагах подстроятся под него.</p>
      {TYPES.map((t) => {
        const active = form.type === t.value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => setForm({ ...form, type: t.value })}
            className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
              active ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200" : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
          >
            <span className={`text-sm font-semibold ${active ? "text-blue-700" : "text-slate-800"}`}>{t.label}</span>
            <span className="text-xs text-slate-500">{t.description}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────── Step 2: Basic fields ────────────────────────────

function Step2({ form, setForm, periods }: { form: FormState; setForm: (f: FormState) => void; periods: PlanningPeriod[] }) {
  return (
    <div className="grid gap-3 text-sm">
      <p className="text-xs text-slate-500">Тип: <span className="font-medium text-slate-700">{TYPES.find((t) => t.value === form.type)?.label}</span></p>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Название *</span>
        <input
          autoFocus
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Например, «Email-канал MVP»"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Описание</span>
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Контекст, ссылки, доказательства…"
          className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-slate-600">Диапазон недель (опционально)</legend>
        <WeekGridPicker
          periods={periods}
          startId={form.start_period_id}
          endId={form.end_period_id}
          onChange={(s, e) => setForm({ ...form, start_period_id: s, end_period_id: e })}
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Первый клик — старт. Второй — дедлайн. Один клик = одна неделя.
        </p>
      </fieldset>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Оценка, часов</span>
        <input
          type="number"
          min={0}
          step={0.5}
          value={form.estimate_hours}
          onChange={(e) => setForm({ ...form, estimate_hours: e.target.value })}
          placeholder="0"
          className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
        />
      </label>
    </div>
  );
}

// ─────────────────────── Step 3a: JTBD ───────────────────────────────────

function Step3Jtbd({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const hint = JTBD_HINT_BY_TYPE[form.type] ?? JTBD_HINT_BY_TYPE.product_maturity;
  return (
    <div className="grid gap-3 text-sm">
      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-900">
        <p className="mb-1 font-semibold">{hint.title}</p>
        <p className="mb-2 leading-snug">{hint.description}</p>
        <p className="italic opacity-80">Пример: {hint.example}</p>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">JTBD (работа клиента) *</span>
        <textarea
          autoFocus
          rows={4}
          value={form.jtbd}
          onChange={(e) => setForm({ ...form, jtbd: e.target.value })}
          placeholder={hint.placeholder}
          className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>
    </div>
  );
}

// ─────────────────────── Step 3b: Experiment ────────────────────────────

function Step3Experiment({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const hint = JTBD_HINT_BY_TYPE.experiment;
  return (
    <div className="grid gap-3 text-sm">
      <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 text-xs text-violet-900">
        <p className="mb-1 font-semibold">{hint.title}</p>
        <p className="mb-2 leading-snug">{hint.description}</p>
        <p className="italic opacity-80">Пример гипотезы: {hint.example}</p>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Гипотеза *</span>
        <textarea
          autoFocus
          rows={2}
          value={form.hypothesis}
          onChange={(e) => setForm({ ...form, hypothesis: e.target.value })}
          placeholder="Если X, то Y увеличится на Z%, потому что…"
          className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Критерий успеха *</span>
        <textarea
          rows={2}
          value={form.success_criteria}
          onChange={(e) => setForm({ ...form, success_criteria: e.target.value })}
          placeholder="Что считаем успехом численно"
          className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Kill criteria *</span>
        <textarea
          rows={2}
          value={form.kill_criteria}
          onChange={(e) => setForm({ ...form, kill_criteria: e.target.value })}
          placeholder="При каком результате убиваем"
          className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Выборка / длительность</span>
        <input
          value={form.sample_size_or_duration}
          onChange={(e) => setForm({ ...form, sample_size_or_duration: e.target.value })}
          placeholder="Например, 100 клиентов или 2 недели"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>
    </div>
  );
}

// ─────────────────────── Step 4: Links ──────────────────────────────────

function Step4({
  form, setForm, metrics,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  metrics: Array<{ id: string; title: string }>;
}) {
  const toggleMetric = (id: string) => {
    const next = form.linked_metric_ids.includes(id)
      ? form.linked_metric_ids.filter((m) => m !== id)
      : [...form.linked_metric_ids, id];
    setForm({ ...form, linked_metric_ids: next });
  };
  return (
    <div className="grid gap-3 text-sm">
      <div>
        <p className="mb-2 text-xs font-medium text-slate-600">Связанные метрики (можно несколько)</p>
        {metrics.length === 0 ? (
          <p className="text-xs text-slate-400">Метрик ещё нет в этом направлении.</p>
        ) : (
          <div className="grid gap-1">
            {metrics.map((m) => {
              const checked = form.linked_metric_ids.includes(m.id);
              return (
                <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50">
                  <input type="checkbox" checked={checked} onChange={() => toggleMetric(m.id)} />
                  <span className="truncate">{m.title}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <p className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-500">
        Сделки и клиентов привяжете в детальной карточке после создания — там же укажете <span className="font-mono">blocks_stage</span> (pilot/production).
      </p>
    </div>
  );
}

