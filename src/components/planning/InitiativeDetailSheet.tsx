"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Trash2, GitBranch, Skull } from "lucide-react";
import { toast } from "sonner";
import type {
  PlanningInitiative,
  PlanningInitiativeDependency,
  PlanningInitiativeMetricLink,
  PlanningInitiativeDealLink,
  PlanningInitiativeClientLink,
  PlanningPeriod,
  PlanningDeal,
  InitiativeStatus,
  InitiativeType,
  ExperimentDecision,
  ReplanReason,
} from "@/types/planning";
import { usePlanningStore } from "@/lib/planning-store";
import { INITIATIVE_STATUS_LABEL, SEMANTIC_CLASS, initiativeStatusTone } from "@/lib/planning-colors";
import { RicePicker } from "./RicePicker";
import { ExperimentFields } from "./ExperimentFields";
import { InitiativeDependenciesEditor } from "./InitiativeDependenciesEditor";
import { ReplanReasonDialog } from "./ReplanReasonDialog";

interface DetailData extends PlanningInitiative {
  linked_metrics: PlanningInitiativeMetricLink[];
  linked_deals: PlanningInitiativeDealLink[];
  linked_clients: PlanningInitiativeClientLink[];
  dependencies: PlanningInitiativeDependency[];
}

interface Props { initiativeId: string | null; onClose: () => void; }

const TYPE_LABEL: Record<InitiativeType, string> = {
  client_blocker: "Блокер клиента",
  product_maturity: "Зрелость продукта",
  tech_debt: "Тех. долг",
  experiment: "Эксперимент",
  support: "Поддержка",
};

const TYPES = Object.entries(TYPE_LABEL) as Array<[InitiativeType, string]>;
const STATUSES: InitiativeStatus[] = ["planned", "in_progress", "done", "killed"];

export function InitiativeDetailSheet({ initiativeId, onClose }: Props) {
  const initiatives = usePlanningStore((s) => s.initiatives);
  const metrics = usePlanningStore((s) => s.metrics);
  const refresh = usePlanningStore((s) => s.fetchAll);

  const [data, setData] = useState<DetailData | null>(null);
  const [periods, setPeriods] = useState<PlanningPeriod[]>([]);
  const [allDeals, setAllDeals] = useState<PlanningDeal[]>([]);
  const [replanPending, setReplanPending] = useState<null | { patch: Partial<DetailData>; reasonHint?: string }>(null);
  const [loading, setLoading] = useState(false);

  const open = initiativeId !== null;

  const load = useCallback(async () => {
    if (!initiativeId) return;
    setLoading(true);
    const [iniRes, perRes, dealRes] = await Promise.all([
      fetch(`/api/planning/initiatives/${initiativeId}`),
      fetch(`/api/planning/periods`),
      fetch(`/api/planning/deals`),
    ]);
    if (iniRes.ok) setData(await iniRes.json());
    if (perRes.ok) setPeriods(await perRes.json());
    if (dealRes.ok) setAllDeals(await dealRes.json());
    setLoading(false);
  }, [initiativeId]);

  useEffect(() => {
    if (!open) return;
    load();
    // Reset to null lazily via a microtask when closing.
    return () => { queueMicrotask(() => setData(null)); };
  }, [open, load]);

  // PATCH helper. For "sensitive" field changes (status / due_period_id / large estimate delta)
  // we open ReplanReasonDialog and defer the save until the user confirms.
  const patch = async (updates: Partial<DetailData>, replanReason: ReplanReason | null = null) => {
    if (!data) return;
    const sensitive =
      ("status" in updates && updates.status !== data.status) ||
      ("due_period_id" in updates && updates.due_period_id !== data.due_period_id) ||
      ("estimate_hours" in updates && data.estimate_hours
        && Math.abs(Number(updates.estimate_hours ?? 0) - Number(data.estimate_hours)) / Number(data.estimate_hours) > 0.2);

    if (sensitive && !replanReason && updates.status !== "killed") {
      // Open dialog; defer save.
      setReplanPending({ patch: updates });
      return;
    }

    const body: Record<string, unknown> = { ...updates };
    if (replanReason) body.replan_reason = replanReason;
    if (updates.status === "killed") body.replan_reason = { code: "kill_criteria_triggered" };

    const res = await fetch(`/api/planning/initiatives/${data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) { toast.error("Не сохранено"); return; }
    const next = await res.json();
    setData((d) => d ? { ...d, ...next } : d);
    refresh();
  };

  const onConfirmReplan = async (reason: ReplanReason | null) => {
    if (!replanPending) return;
    const { patch: p } = replanPending;
    setReplanPending(null);
    await patch(p, reason);
  };

  const onKill = async () => {
    if (!data) return;
    if (!confirm(`Убить инициативу «${data.title}»?`)) return;
    await patch({ status: "killed" });
  };

  const onDelete = async () => {
    if (!data) return;
    if (!confirm(`Удалить инициативу «${data.title}»? Это действие необратимо.`)) return;
    const res = await fetch(`/api/planning/initiatives/${data.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Не удалось"); return; }
    refresh();
    onClose();
  };

  const onSpawn = async () => {
    if (!data) return;
    const res = await fetch(`/api/planning/initiatives`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction_id: data.direction_id,
        title: `${data.title} (продолжение)`,
        type: data.type,
        description: data.description,
        jtbd: data.jtbd,
        estimate_hours: data.estimate_hours,
        rice_reach: data.rice_reach,
        rice_impact: data.rice_impact,
        rice_confidence: data.rice_confidence,
        key_assumptions: data.key_assumptions,
        kill_criteria: data.kill_criteria,
        parent_initiative_id: data.id,
        hypothesis: data.hypothesis,
        success_criteria: data.success_criteria,
        sample_size_or_duration: data.sample_size_or_duration,
        linked_metric_ids: data.linked_metrics.map((l) => l.metric_id),
      }),
    });
    if (!res.ok) { toast.error("Не удалось создать продолжение"); return; }
    const created = await res.json();
    toast.success("Продолжение создано");
    refresh();
    // Switch sheet to the new initiative.
    onClose();
    setTimeout(() => {
      // Allow store to repopulate first; consumer reopens.
      usePlanningStore.setState({ selectedInitiativeId: created.id });
    }, 100);
  };

  // Auto reach = linked_deals + linked_clients.
  const autoReach = (data?.linked_deals.length ?? 0) + (data?.linked_clients.length ?? 0);

  // Spawn B' condition: status=killed OR last replan was scope_(under|over)estimated.
  const canSpawn = useMemo(() => {
    if (!data) return false;
    if (data.status === "killed") return true;
    // Heuristic: rely on display only; full check would require fetching changelog.
    return data.status === "done";
  }, [data]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 flex">
        <button type="button" aria-label="Закрыть" onClick={onClose} className="flex-1 bg-black/30" />
        <aside className="flex w-[560px] flex-col overflow-y-auto bg-white shadow-xl">
          {/* Header */}
          <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
            <div className="flex-1">
              {data ? (
                <input
                  defaultValue={data.title}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== data.title) patch({ title: v }); }}
                  className="w-full rounded-md border border-transparent px-1 py-0.5 text-lg font-semibold hover:border-slate-200 focus:border-blue-400 focus:bg-slate-50 focus:outline-none"
                />
              ) : <div className="text-sm text-slate-400">Загрузка…</div>}
              {data && (
                <p className="px-1 text-xs text-slate-500">
                  {TYPE_LABEL[data.type]}
                  {data.parent_initiative_id ? " · продолжение" : ""}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X className="size-5" />
            </button>
          </header>

          {!data ? (
            <div className="p-6 text-sm text-slate-500">{loading ? "Загрузка…" : "Не найдено"}</div>
          ) : (
            <div className="flex flex-col gap-4 p-5">
              {/* Status / Type / Due */}
              <section className="grid grid-cols-2 gap-3 text-sm">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Тип</span>
                  <select
                    value={data.type}
                    onChange={(e) => patch({ type: e.target.value as InitiativeType })}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5"
                  >
                    {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Статус</span>
                  <div className="flex flex-wrap gap-1">
                    {STATUSES.map((s) => {
                      const tone = initiativeStatusTone(s);
                      const c = SEMANTIC_CLASS[tone];
                      const active = data.status === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => patch({ status: s })}
                          className={`rounded-md border px-2 py-1 text-xs transition-colors ${active ? `${c.bg} ${c.text} ${c.border} font-semibold` : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}
                        >
                          {INITIATIVE_STATUS_LABEL[s]}
                        </button>
                      );
                    })}
                  </div>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Дедлайн (неделя/месяц)</span>
                  <select
                    value={data.due_period_id ?? ""}
                    onChange={(e) => patch({ due_period_id: e.target.value || null })}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5"
                  >
                    <option value="">— не задан —</option>
                    {periods
                      .slice()
                      .sort((a, b) => a.start_date.localeCompare(b.start_date))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {labelForPeriod(p)}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Оценка (ч)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    defaultValue={data.estimate_hours ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v !== data.estimate_hours) patch({ estimate_hours: v });
                    }}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 tabular-nums"
                  />
                </label>
              </section>

              {/* Description */}
              <section>
                <span className="mb-1 block text-xs font-medium text-slate-600">Описание</span>
                <textarea
                  defaultValue={data.description ?? ""}
                  rows={4}
                  onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== data.description) patch({ description: v }); }}
                  placeholder="Контекст, конкуренты, ссылки…"
                  className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                />
              </section>

              {/* JTBD — for blocker/maturity */}
              {(data.type === "client_blocker" || data.type === "product_maturity") && (
                <section>
                  <span className="mb-1 block text-xs font-medium text-slate-600">JTBD (работа клиента) *</span>
                  <textarea
                    defaultValue={data.jtbd ?? ""}
                    rows={2}
                    onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== data.jtbd) patch({ jtbd: v }); }}
                    className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </section>
              )}

              {/* RICE */}
              <RicePicker
                reach={data.rice_reach}
                impact={data.rice_impact}
                confidence={data.rice_confidence}
                estimateHours={data.estimate_hours}
                riceScore={Number(data.rice_score)}
                autoReach={autoReach}
                onChange={(p) => patch(p as Partial<DetailData>)}
              />

              {/* Key assumptions */}
              <KeyAssumptions
                values={data.key_assumptions ?? []}
                onChange={(arr) => patch({ key_assumptions: arr.length ? arr : null })}
              />

              {/* Kill criteria (also shown standalone for non-experiments) */}
              {data.type !== "experiment" && (
                <section>
                  <span className="mb-1 block text-xs font-medium text-slate-600">Kill criteria</span>
                  <textarea
                    defaultValue={data.kill_criteria ?? ""}
                    rows={2}
                    placeholder="При каком сигнале убиваем"
                    onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== data.kill_criteria) patch({ kill_criteria: v }); }}
                    className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </section>
              )}

              {/* Experiment-specific fields */}
              {data.type === "experiment" && (
                <ExperimentFields
                  hypothesis={data.hypothesis}
                  successCriteria={data.success_criteria}
                  killCriteria={data.kill_criteria}
                  sampleSizeOrDuration={data.sample_size_or_duration}
                  experimentResult={data.experiment_result}
                  experimentDecision={data.experiment_decision}
                  onChange={(p) => patch(p as Partial<DetailData>)}
                />
              )}

              {/* Linked metrics */}
              <LinkedMulti
                title="Связанные метрики"
                allItems={metrics.map((m) => ({ id: m.id, label: m.title }))}
                selectedIds={data.linked_metrics.map((l) => l.metric_id)}
                onChange={async (next) => {
                  await fetch(`/api/planning/initiatives/${data.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ linked_metric_ids: next }),
                  });
                  load();
                }}
              />

              {/* Linked deals */}
              <LinkedMulti
                title="Связанные сделки"
                allItems={allDeals.map((d) => ({ id: d.id, label: `${d.title} · ${d.stage}` }))}
                selectedIds={data.linked_deals.map((l) => l.deal_id)}
                onChange={async (next) => {
                  await fetch(`/api/planning/initiatives/${data.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ linked_deal_ids: next }),
                  });
                  load();
                }}
              />

              {/* Dependencies */}
              <InitiativeDependenciesEditor
                initiativeId={data.id}
                dependencies={data.dependencies}
                allInitiatives={initiatives}
                onChange={load}
              />

              {/* Actions */}
              <section className="flex items-center justify-between gap-2 border-t border-slate-200 pt-3">
                <div className="flex gap-2">
                  {canSpawn && (
                    <button
                      type="button"
                      onClick={onSpawn}
                      className="inline-flex items-center gap-1 rounded-md border border-purple-300 bg-purple-50 px-3 py-1.5 text-sm text-purple-700 hover:bg-purple-100"
                      title="Создать продолжение B' (parent_initiative_id ← текущая)"
                    >
                      <GitBranch className="size-4" /> Создать продолжение
                    </button>
                  )}
                  {data.status !== "killed" && data.status !== "done" && (
                    <button
                      type="button"
                      onClick={onKill}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-400 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                    >
                      <Skull className="size-4" /> Убить
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onDelete}
                  className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100"
                >
                  <Trash2 className="size-4" /> Удалить
                </button>
              </section>
            </div>
          )}
        </aside>
      </div>

      <ReplanReasonDialog
        open={replanPending !== null}
        onClose={() => setReplanPending(null)}
        onConfirm={onConfirmReplan}
        suggestedCode={replanPending?.reasonHint}
      />
    </>
  );
}

function labelForPeriod(p: PlanningPeriod): string {
  const dt = p.type;
  if (dt === "week" && p.week_n) return `W${p.week_n} ${p.year} (${p.start_date} → ${p.end_date})`;
  if (dt === "month" && p.month_n) return `${String(p.month_n).padStart(2, "0")}.${p.year}`;
  if (dt === "quarter" && p.quarter_n) return `Q${p.quarter_n} ${p.year}`;
  if (dt === "year") return `${p.year}`;
  return `${p.type} ${p.start_date}`;
}

function KeyAssumptions({ values, onChange }: { values: string[]; onChange: (arr: string[]) => void }) {
  return (
    <section>
      <span className="mb-1 block text-xs font-medium text-slate-600">Ключевые допущения (до 3)</span>
      <div className="flex flex-col gap-1">
        {[0, 1, 2].map((i) => (
          <input
            key={i}
            defaultValue={values[i] ?? ""}
            placeholder={`Допущение ${i + 1}`}
            onBlur={(e) => {
              const v = e.target.value.trim();
              const next = [...values];
              if (v) next[i] = v; else next.splice(i, 1);
              onChange(next.filter(Boolean));
            }}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        ))}
      </div>
    </section>
  );
}

function LinkedMulti({ title, allItems, selectedIds, onChange }: {
  title: string;
  allItems: Array<{ id: string; label: string }>;
  selectedIds: string[];
  onChange: (next: string[]) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const sel = new Set(selectedIds);
  const labelMap = new Map(allItems.map((x) => [x.id, x.label]));
  const toggle = (id: string) => {
    const next = sel.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    onChange(next);
  };
  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        <button type="button" onClick={() => setOpen(!open)} className="text-[10px] uppercase text-blue-600 hover:underline">
          {open ? "свернуть" : "редактировать"}
        </button>
      </div>
      {selectedIds.length === 0 ? (
        <p className="text-xs text-slate-400">Не выбрано</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {selectedIds.map((id) => (
            <li key={id} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">
              {labelMap.get(id) ?? id}
              <button type="button" onClick={() => toggle(id)} className="text-slate-400 hover:text-red-600">×</button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white">
          {allItems.map((it) => (
            <label key={it.id} className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-1 text-sm last:border-b-0 hover:bg-slate-50">
              <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} />
              <span className="truncate">{it.label}</span>
            </label>
          ))}
          {allItems.length === 0 && <p className="px-2 py-2 text-xs text-slate-400">Пусто</p>}
        </div>
      )}
    </section>
  );
}

// Re-export the ExperimentDecision type usage to keep prop typing clean.
export type { ExperimentDecision };
