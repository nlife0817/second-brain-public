"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useBrainStore } from "@/lib/store";
import {
  METRIC_KIND_CONFIG,
  type MetricKind,
  type CreateMetricPayload,
  type GoalMetric,
} from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  goalId: string;
}

export function CreateMetricDialog({ open, onOpenChange, goalId }: Props) {
  const createMetric = useBrainStore((s) => s.createMetric);
  const goals = useBrainStore((s) => s.goals);
  const categories = useBrainStore((s) => s.categories);

  // Walk up to root collecting all KRs available for inheritance.
  const inheritableKRs: { metric: GoalMetric; goalTitle: string; goalLevel: string }[] = useMemo(() => {
    const out: { metric: GoalMetric; goalTitle: string; goalLevel: string }[] = [];
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return out;
    let cur = goal.parent_id ? goals.find((g) => g.id === goal.parent_id) : undefined;
    let safety = 8;
    while (cur && safety-- > 0) {
      for (const m of cur.metrics ?? []) {
        out.push({ metric: m, goalTitle: cur.title, goalLevel: cur.level });
      }
      cur = cur.parent_id ? goals.find((g) => g.id === cur!.parent_id) : undefined;
    }
    return out;
  }, [goals, goalId]);

  // Whether this goal has any descendants (BFS through goals tree). Drives
  // visibility of the "распределить по детям" checkbox.
  const hasDescendants = useMemo(() => {
    const childrenOf = new Map<string | null, string[]>();
    for (const g of goals) {
      const arr = childrenOf.get(g.parent_id) ?? [];
      arr.push(g.id);
      childrenOf.set(g.parent_id, arr);
    }
    return (childrenOf.get(goalId) ?? []).length > 0;
  }, [goals, goalId]);

  const [parentMetricId, setParentMetricId] = useState<string>("");
  const [propagate, setPropagate] = useState<boolean>(true);
  const inheritedFrom = parentMetricId
    ? inheritableKRs.find((x) => x.metric.id === parentMetricId)?.metric ?? null
    : null;

  const [kind, setKind] = useState<MetricKind>("numeric");
  const effectiveKind: MetricKind = inheritedFrom ? inheritedFrom.kind : kind;

  const [title, setTitle] = useState("");
  const [unit, setUnit] = useState("");
  const [target, setTarget] = useState("");
  const [start, setStart] = useState("");
  const [direction, setDirection] = useState<"up" | "down">("up");
  const effectiveDirection = inheritedFrom?.direction ?? direction;
  const effectiveUnit = inheritedFrom?.unit ?? unit;

  const [tasksCats, setTasksCats] = useState<string[]>([]);
  const effectiveTasksCats = inheritedFrom?.tasks_category_ids ?? tasksCats;

  const [saving, setSaving] = useState(false);

  function pickInherit(id: string): void {
    setParentMetricId(id);
    if (id) {
      const m = inheritableKRs.find((x) => x.metric.id === id)?.metric;
      if (m && !title) setTitle(m.title);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || saving) return;
    if (effectiveKind === "tasks" && effectiveTasksMode === "auto" && effectiveTasksCats.length === 0) return;
    setSaving(true);
    try {
      const payload: CreateMetricPayload = {
        kind: effectiveKind,
        title: title.trim(),
        unit: (effectiveUnit || "").trim() || null,
        direction: effectiveDirection,
        parent_metric_id: parentMetricId || null,
        // Propagation only makes sense for top-level KRs (not inherited copies)
        // and only when the goal actually has descendants.
        propagate_to_children: !parentMetricId && hasDescendants && propagate,
      };
      if (effectiveKind === "numeric") {
        payload.target_value = target ? Number(target) : null;
        if (effectiveDirection === "down") {
          payload.start_value = start ? Number(start) : null;
          payload.current_value = start ? Number(start) : null;
        } else {
          payload.current_value = 0;
        }
      } else if (effectiveKind === "checklist") {
        payload.payload = { items: [] };
      } else if (effectiveKind === "boolean") {
        payload.payload = { done: false };
      } else if (effectiveKind === "tasks") {
        payload.tasks_category_ids = effectiveTasksCats;
      }
      await createMetric(goalId, payload);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  const toggleCategory = (id: string): void => {
    setTasksCats((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая метрика (KR)</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {inheritableKRs.length > 0 && (
            <div>
              <label className="text-xs font-medium text-slate-600">Наследует от</label>
              <select
                value={parentMetricId}
                onChange={(e) => pickInherit(e.target.value)}
                className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-slate-400 focus:outline-none"
              >
                <option value="">— Независимый KR —</option>
                {inheritableKRs.map((x) => (
                  <option key={x.metric.id} value={x.metric.id}>
                    {x.goalLevel}: {x.goalTitle} · {x.metric.title} ({METRIC_KIND_CONFIG[x.metric.kind].label})
                  </option>
                ))}
              </select>
              {inheritedFrom && (
                <p className="mt-1 text-[10px] text-slate-500">
                  Тип, единица, направление наследуются. Цель задаётся вручную.
                </p>
              )}
            </div>
          )}

          {!inheritedFrom && (
            <div>
              <label className="text-xs font-medium text-slate-600">Тип</label>
              <div className="mt-1 grid grid-cols-1 gap-1">
                {(Object.entries(METRIC_KIND_CONFIG) as [MetricKind, typeof METRIC_KIND_CONFIG.numeric][]).map(([k, cfg]) => (
                  <button
                    type="button"
                    key={k}
                    onClick={() => setKind(k)}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition",
                      kind === k
                        ? "border-slate-900 bg-slate-50"
                        : "border-slate-200 bg-white hover:border-slate-300",
                    )}
                  >
                    <span className="text-base">{cfg.icon}</span>
                    <div className="flex-1">
                      <div className="font-medium text-slate-900">{cfg.label}</div>
                      <div className="text-[10px] text-slate-500">{cfg.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-600">Название</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>

          {effectiveKind === "numeric" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-600">Цель</label>
                  <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">
                    Единица {inheritedFrom && <span className="text-slate-400">(наследуется)</span>}
                  </label>
                  <Input
                    value={effectiveUnit ?? ""}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="₽, кг, шт"
                    disabled={!!inheritedFrom}
                  />
                </div>
              </div>
              {effectiveKind === "numeric" && !inheritedFrom && (
                <div>
                  <label className="text-xs font-medium text-slate-600">Направление</label>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setDirection("up")}
                      className={cn(
                        "flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium",
                        direction === "up" ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white",
                      )}
                    >
                      ↑ Расти к цели
                    </button>
                    <button
                      type="button"
                      onClick={() => setDirection("down")}
                      className={cn(
                        "flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium",
                        direction === "down" ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white",
                      )}
                    >
                      ↓ Снижать к цели
                    </button>
                  </div>
                </div>
              )}
              {effectiveKind === "numeric" && effectiveDirection === "down" && (
                <div>
                  <label className="text-xs font-medium text-slate-600">Стартовое значение</label>
                  <Input type="number" value={start} onChange={(e) => setStart(e.target.value)} />
                </div>
              )}
            </>
          )}

          {effectiveKind === "tasks" && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Категории задач {inheritedFrom && <span className="ml-1 normal-case text-slate-400">(наследуются)</span>}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Задачи попадают в KR автоматически: если у задачи дедлайн внутри
                периода цели и категория из выбранных ниже.
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {categories.map((c) => {
                  const active = (effectiveTasksCats ?? []).includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={!!inheritedFrom}
                      onClick={() => toggleCategory(c.id)}
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600",
                        inheritedFrom && "opacity-60 cursor-not-allowed",
                      )}
                    >
                      <span style={{ color: active ? c.color : undefined }}>{c.icon}</span>
                      {c.name}
                    </button>
                  );
                })}
              </div>
              {(effectiveTasksCats ?? []).length === 0 && (
                <p className="mt-1 text-[10px] text-rose-500">Выбери хотя бы одну категорию</p>
              )}
            </div>
          )}

          {!parentMetricId && hasDescendants && (
            <label className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50/40 p-2.5 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={propagate}
                onChange={(e) => setPropagate(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong className="font-medium">Распределить по дочерним целям.</strong>{" "}
                Тот же KR появится у каждого квартала / месяца / недели внутри —
                с пустой целью, готовый к ручному вводу плана.{" "}
                <span className="text-slate-500">
                  Факт ребёнка автоматически суммируется в этот KR.
                </span>
              </span>
            </label>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={!title.trim() || saving}>
              {saving ? "Создание…" : "Создать"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
