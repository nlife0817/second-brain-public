"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Trash2, GitBranch, XCircle } from "lucide-react";
import { toast } from "sonner";
import type {
  PlanningInitiative,
  PlanningInitiativeDependency,
  PlanningInitiativeMetricLink,
  PlanningInitiativeClientBlock,
  PlanningInitiativeClientLink,
  PlanningPeriod,
  DealBlockingStage,
  InitiativeStatus,
  InitiativeType,
  ExperimentDecision,
  ReplanReason,
} from "@/types/planning";
import { usePlanningStore } from "@/lib/planning-store";
import { INITIATIVE_STATUS_LABEL, SEMANTIC_CLASS, initiativeStatusTone } from "@/lib/planning-colors";
import { INITIATIVE_TYPE_DESCRIPTION, JTBD_HINT_BY_TYPE } from "@/lib/planning-initiative-meta";
import { RicePicker } from "./RicePicker";
import { ExperimentFields } from "./ExperimentFields";
import { ReplanReasonDialog } from "./ReplanReasonDialog";
import { WeekGridPicker } from "./WeekGridPicker";

interface DetailData extends PlanningInitiative {
  linked_metrics: PlanningInitiativeMetricLink[];
  // P8: переименовано из linked_deals.
  client_blocks: PlanningInitiativeClientBlock[];
  linked_clients: PlanningInitiativeClientLink[];
  dependencies: PlanningInitiativeDependency[];
}

// P8: shape для глобального селектора сделок (см. /api/clients/deals).
interface DealWithContext {
  id: string;
  client_id: string;
  client_name: string;
  title: string;
  status_name: string | null;
}

interface Props { initiativeId: string | null; onClose: () => void; }

const TYPE_LABEL: Record<InitiativeType, string> = {
  client_blocker: "Блокер клиента",
  product_maturity: "Развитие продукта",
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
  const [allDeals, setAllDeals] = useState<DealWithContext[]>([]);
  const [replanPending, setReplanPending] = useState<null | { patch: Partial<DetailData>; reasonHint?: string }>(null);
  const [loading, setLoading] = useState(false);

  const open = initiativeId !== null;

  const load = useCallback(async () => {
    if (!initiativeId) return;
    setLoading(true);
    // P8: тянем сделки из глобального /api/clients/deals — сделки теперь
    // живут внутри клиентов, отдельной /api/planning/deals больше нет.
    const [iniRes, perRes, dealRes] = await Promise.all([
      fetch(`/api/planning/initiatives/${initiativeId}`),
      fetch(`/api/planning/periods`),
      fetch(`/api/clients/deals`),
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

  // PATCH helper.
  //
  // ReplanReasonDialog открывается ТОЛЬКО при изменении end_period_id у инициативы,
  // у которой дедлайн уже стоял (data.end_period_id !== null). Первое задание дедлайна
  // и смена status — без диалога (PLAN_PLANNING_REWORK §P1.3).
  //
  // status='killed' автоматически проставляет replan_reason = kill_criteria_triggered.
  const patch = async (updates: Partial<DetailData>, replanReason: ReplanReason | null = null) => {
    if (!data) return;
    const isReplanEndPeriod =
      "end_period_id" in updates
      && data.end_period_id !== null
      && updates.end_period_id !== data.end_period_id;

    if (isReplanEndPeriod && !replanReason && updates.status !== "killed") {
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
    if (!confirm(`Закрыть инициативу «${data.title}» без реализации?\n\nЭто внутренний статус «killed»: инициатива остаётся в журнале, но не считается выполненной и попадает в архив.`)) return;
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

  // P8: Auto reach = client_blocks + linked_clients.
  const autoReach = (data?.client_blocks.length ?? 0) + (data?.linked_clients.length ?? 0);

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
              {/* Type + inline hint */}
              <section className="text-sm">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Type</span>
                  <select
                    value={data.type}
                    onChange={(e) => patch({ type: e.target.value as InitiativeType })}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5"
                  >
                    {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <p className="mt-1 text-[11px] leading-snug text-slate-500">
                  {INITIATIVE_TYPE_DESCRIPTION[data.type]}
                </p>
              </section>

              {/* Status + Estimate */}
              <section className="grid grid-cols-2 gap-3 text-sm">
                <div className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Status</span>
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
                </div>

                <div className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Estimate (h)</span>
                  <EstimateInput
                    value={data.estimate_hours}
                    onChange={(v) => { if (v !== data.estimate_hours) patch({ estimate_hours: v }); }}
                  />
                </div>
              </section>

              {/* Week range — start..end (last week = deadline). §P2: grid 4×13. */}
              <section>
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  Week range (start → deadline)
                </span>
                <WeekGridPicker
                  periods={periods}
                  startId={data.start_period_id}
                  endId={data.end_period_id ?? data.due_period_id}
                  onChange={(s, e) => {
                    // Атомарный patch: если меняем end-period (≠ старого) — это reform
                    // и поднимется ReplanReasonDialog. Иначе один PATCH.
                    const patchObj: Partial<DetailData> = {};
                    if (s !== data.start_period_id) patchObj.start_period_id = s;
                    if (e !== (data.end_period_id ?? data.due_period_id)) patchObj.end_period_id = e;
                    if (Object.keys(patchObj).length > 0) patch(patchObj);
                  }}
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Shifting the deadline (last week) of an existing range = replan
                  and will ask for a reason.
                </p>
              </section>

              {/* Description */}
              <section>
                <span className="mb-1 block text-xs font-medium text-slate-600">Description</span>
                <textarea
                  defaultValue={data.description ?? ""}
                  rows={4}
                  onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== data.description) patch({ description: v }); }}
                  placeholder="Context, competitors, links…"
                  className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                />
              </section>

              {/* JTBD — for blocker/maturity */}
              {(data.type === "client_blocker" || data.type === "product_maturity") && (
                <section>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-600">JTBD (customer&apos;s job) *</span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-400" title={JTBD_HINT_BY_TYPE[data.type].description}>
                      Example below
                    </span>
                  </div>
                  <textarea
                    defaultValue={data.jtbd ?? ""}
                    rows={3}
                    placeholder={JTBD_HINT_BY_TYPE[data.type].placeholder}
                    onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== data.jtbd) patch({ jtbd: v }); }}
                    className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] italic text-slate-500">
                    {JTBD_HINT_BY_TYPE[data.type].example}
                  </p>
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
                    placeholder="Signal that triggers kill"
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
                title="Linked metrics"
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

              {/* P8: Blocked clients — для client_blocker таблица «клиент / сделка / stage».
                  Для других типов инициатив блокировки клиентов обычно не нужны (RICE reach
                  по-прежнему учитывает linked_clients). */}
              {data.type === "client_blocker" && (
                <ClientBlocksEditor
                  blocks={data.client_blocks}
                  allDeals={allDeals}
                  initiativeId={data.id}
                  onChanged={load}
                />
              )}

              {/* Dependencies section removed (PLAN_PLANNING_REWORK §0). DB table planning_initiative_dependency
                  оставлена пустой для совместимости; UI editor выпилен. */}

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
                      title="Перевести в статус killed: инициатива не выполнена, но и не «забыта» — остаётся в журнале и архиве. Чаще всего применяется по сработавшему kill criteria."
                      className="inline-flex items-center gap-1 rounded-md border border-slate-400 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                    >
                      <XCircle className="size-4" /> Закрыть без реализации
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

// P7.3: estimate input + preset chips (4h / 8h / 16h / 40h = полдня/день/2дня/неделя).
function EstimateInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));
  const PRESETS = [4, 8, 16, 40];
  const apply = (h: number) => {
    setDraft(String(h));
    onChange(h);
  };
  return (
    <div className="flex flex-col gap-1">
      <input
        type="number"
        min={0}
        step={0.5}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = draft === "" ? null : Number(draft);
          onChange(v);
        }}
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums"
      />
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => apply(h)}
            className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors ${
              Number(draft) === h
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
            }`}
            title={h === 4 ? "Полдня" : h === 8 ? "День" : h === 16 ? "2 дня" : "Неделя"}
          >
            {h}h
          </button>
        ))}
      </div>
    </div>
  );
}

function KeyAssumptions({ values, onChange }: { values: string[]; onChange: (arr: string[]) => void }) {
  return (
    <section>
      <span className="mb-1 block text-xs font-medium text-slate-600">Key assumptions (up to 3)</span>
      <div className="flex flex-col gap-1">
        {[0, 1, 2].map((i) => (
          <input
            key={i}
            defaultValue={values[i] ?? ""}
            placeholder={`Assumption ${i + 1}`}
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
          {open ? "collapse" : "edit"}
        </button>
      </div>
      {selectedIds.length === 0 ? (
        <p className="text-xs text-slate-400">None selected</p>
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
          {allItems.length === 0 && <p className="px-2 py-2 text-xs text-slate-400">Empty</p>}
        </div>
      )}
    </section>
  );
}

// Re-export the ExperimentDecision type usage to keep prop typing clean.
export type { ExperimentDecision };

// P8: ClientBlocksEditor — заменяет DealLinksEditor. Связь привязана к
// клиенту, с опциональной привязкой к конкретной сделке клиента и blocks_stage.
function ClientBlocksEditor({
  blocks, allDeals, initiativeId, onChanged,
}: {
  blocks: PlanningInitiativeClientBlock[];
  allDeals: DealWithContext[];
  initiativeId: string;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const dealsById = useMemo(() => new Map(allDeals.map((d) => [d.id, d])), [allDeals]);
  // Уже выбранные пары (client_id + deal_id|null) для исключения дублей.
  const usedKey = (clientId: string, dealId: string | null) => `${clientId}::${dealId ?? "*"}`;
  const used = new Set(blocks.map((b) => usedKey(b.client_id, b.deal_id)));
  const available = allDeals.filter((d) => !used.has(usedKey(d.client_id, d.id)));

  const setBlock = async (clientId: string, dealId: string | null, stage: DealBlockingStage | null) => {
    setBusy(true);
    try {
      await fetch(`/api/planning/initiatives/${initiativeId}/client-blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, deal_id: dealId, blocks_stage: stage }),
      });
      await onChanged();
    } finally { setBusy(false); }
  };

  const removeBlock = async (clientId: string, dealId: string | null) => {
    setBusy(true);
    try {
      const qs = new URLSearchParams({ client_id: clientId });
      if (dealId) qs.set("deal_id", dealId);
      await fetch(`/api/planning/initiatives/${initiativeId}/client-blocks?${qs}`, {
        method: "DELETE",
      });
      await onChanged();
    } finally { setBusy(false); }
  };

  return (
    <section className="rounded-lg border border-rose-200 bg-rose-50/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-700">Blocked clients</h3>
        <button
          type="button"
          onClick={() => setPicker((v) => !v)}
          disabled={available.length === 0 || busy}
          className="rounded-md border border-rose-300 bg-white px-2 py-0.5 text-[10px] uppercase text-rose-700 hover:bg-rose-50 disabled:opacity-40"
        >
          {picker ? "close" : "+ add"}
        </button>
      </div>

      {blocks.length === 0 ? (
        <p className="text-xs text-slate-500">
          Link clients (and optionally their specific deals) that are waiting for this
          initiative. RICE Reach counts them automatically.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {blocks.map((b) => {
            const deal = b.deal_id ? dealsById.get(b.deal_id) : null;
            const label = deal
              ? `${deal.client_name} — ${deal.title || "сделка"}${deal.status_name ? ` · ${deal.status_name}` : ""}`
              : `${b.client_id} (все сделки)`;
            return (
              <li key={`${b.client_id}::${b.deal_id ?? "*"}`} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm">
                <span className="flex-1 truncate" title={label}>{label}</span>
                <select
                  value={b.blocks_stage ?? ""}
                  onChange={(e) => setBlock(b.client_id, b.deal_id, (e.target.value || null) as DealBlockingStage | null)}
                  disabled={busy}
                  className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs"
                  title="At which stage the client is blocked by this initiative"
                >
                  <option value="">blocks —</option>
                  <option value="pilot">pilot</option>
                  <option value="production">production</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeBlock(b.client_id, b.deal_id)}
                  disabled={busy}
                  className="rounded-md p-1 text-slate-400 hover:bg-rose-100 hover:text-rose-700"
                  title="Remove block"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {picker && (
        <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-white">
          {available.length === 0 ? (
            <p className="px-2 py-2 text-xs text-slate-400">All deals are already linked.</p>
          ) : (
            available.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => { setBlock(d.client_id, d.id, null); setPicker(false); }}
                disabled={busy}
                className="flex w-full items-center justify-between border-b border-slate-100 px-2 py-1.5 text-left text-sm last:border-b-0 hover:bg-slate-50"
              >
                <span className="truncate">
                  {d.client_name}
                  {d.title ? ` — ${d.title}` : ""}
                </span>
                <span className="text-[11px] text-slate-400">{d.status_name ?? "—"}</span>
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}
