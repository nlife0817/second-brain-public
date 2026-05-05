"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useBrainStore } from "@/lib/store";
import { GOAL_LEVEL_CONFIG, type Goal, type GoalLevel, type GoalMetric } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  parentGoal: Goal;
  parentMetric: GoalMetric;
}

const NEXT_LEVEL: Record<GoalLevel, GoalLevel | null> = {
  year: "quarter",
  quarter: "month",
  month: "week",
  week: null,
};

export function DistributeMetricDialog({ open, onOpenChange, parentGoal, parentMetric }: Props) {
  const goals = useBrainStore((s) => s.goals);
  const fetchGoals = useBrainStore((s) => s.fetchGoals);

  const childLevel = NEXT_LEVEL[parentGoal.level];
  const children = useMemo(
    () => goals
      .filter((g) => g.parent_id === parentGoal.id && g.level === childLevel)
      .sort((a, b) => a.position - b.position),
    [goals, parentGoal.id, childLevel],
  );

  // Existing linked replicas of the parent KR — pre-populate their targets.
  const existingByGoal = useMemo(() => {
    const m = new Map<string, GoalMetric>();
    for (const g of goals) {
      for (const km of g.metrics ?? []) {
        if (km.parent_metric_id === parentMetric.id) m.set(g.id, km);
      }
    }
    return m;
  }, [goals, parentMetric.id]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset/seed when dialog opens.
  useEffect(() => {
    if (!open || children.length === 0) return;
    const seed: Record<string, string> = {};
    const parentTarget = parentMetric.target_value;
    const equal = parentTarget != null ? parentTarget / children.length : null;
    for (const g of children) {
      const ex = existingByGoal.get(g.id);
      if (ex?.target_value != null) {
        seed[g.id] = String(ex.target_value);
      } else if (equal != null) {
        seed[g.id] = String(equal);
      } else {
        seed[g.id] = "";
      }
    }
    setValues(seed);
    setError(null);
  }, [open, children, existingByGoal, parentMetric.target_value]);

  const numericValues = children.map((g) => {
    const raw = values[g.id] ?? "";
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  });
  const sumNumeric = numericValues.reduce<number | null>((acc, v) => {
    if (v == null) return acc;
    return (acc ?? 0) + v;
  }, null);
  const targetParent = parentMetric.target_value;
  const diff = sumNumeric != null && targetParent != null ? sumNumeric - Number(targetParent) : null;

  // Rescale all child targets so their sum matches parent.target_value, keeping
  // the existing distribution proportion. Useful after bumping the parent plan
  // ("year was 20M, now 25M — keep the per-quarter shape, just stretch them").
  // If the current sum is 0/empty or parent target is unset, falls back to
  // equal split.
  function rescaleProportionally(): void {
    if (targetParent == null || children.length === 0) return;
    const target = Number(targetParent);
    const currentSum = numericValues.reduce<number>((acc, v) => acc + (v ?? 0), 0);
    const next: Record<string, string> = {};
    if (currentSum > 0) {
      const ratio = target / currentSum;
      for (let i = 0; i < children.length; i++) {
        const v = numericValues[i] ?? 0;
        next[children[i].id] = String(Math.round(v * ratio * 100) / 100);
      }
    } else {
      const equal = target / children.length;
      for (const g of children) {
        next[g.id] = String(Math.round(equal * 100) / 100);
      }
    }
    setValues(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        children: children.map((g) => {
          const raw = values[g.id] ?? "";
          if (raw === "") return { goal_id: g.id, target_value: null };
          const n = Number(raw);
          return { goal_id: g.id, target_value: Number.isFinite(n) ? n : null };
        }),
      };
      const res = await fetch(
        `/api/goals/${parentGoal.id}/metrics/${parentMetric.id}/distribute`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      await fetchGoals();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  if (!childLevel) return null;
  const childLevelLabel = GOAL_LEVEL_CONFIG[childLevel].label.toLowerCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Распределить «{parentMetric.title}» по {childLevelLabel}ам
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex items-center justify-between rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
            <span>План родителя</span>
            <span className="tabular-nums font-medium text-slate-900">
              {targetParent == null ? "—" : Number(targetParent).toLocaleString("ru-RU")}
              {parentMetric.unit ? ` ${parentMetric.unit}` : ""}
            </span>
          </div>

          {children.length === 0 ? (
            <p className="text-xs text-slate-500">Нет дочерних целей уровня «{childLevelLabel}».</p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5">
              {children.map((g) => (
                <label key={g.id} className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs">
                  <span className="truncate text-slate-700">{g.title}</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={values[g.id] ?? ""}
                    onChange={(e) => setValues((p) => ({ ...p, [g.id]: e.target.value }))}
                    className="h-7 w-32 text-xs tabular-nums"
                  />
                </label>
              ))}
            </div>
          )}

          {sumNumeric != null && (
            <div className="flex items-center justify-between rounded-md border border-slate-200 px-2.5 py-1.5 text-xs">
              <span className="text-slate-600">Сумма по детям</span>
              <span className="tabular-nums font-medium text-slate-900">
                {sumNumeric.toLocaleString("ru-RU")}
                {parentMetric.unit ? ` ${parentMetric.unit}` : ""}
                {diff != null && (
                  <span
                    className={cn(
                      "ml-2 text-[10px]",
                      Math.abs(diff) < 0.0001 ? "text-emerald-600" : "text-amber-600",
                    )}
                  >
                    {Math.abs(diff) < 0.0001
                      ? "✓"
                      : diff > 0
                        ? `+${diff.toLocaleString("ru-RU")}`
                        : diff.toLocaleString("ru-RU")}
                  </span>
                )}
              </span>
            </div>
          )}

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="mt-2 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving || children.length === 0 || targetParent == null}
              onClick={rescaleProportionally}
              title="Растянуть текущие доли так, чтобы сумма равнялась плану родителя"
            >
              Пересчитать пропорционально
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
              <Button type="submit" disabled={saving || children.length === 0}>
                {saving ? "Сохранение…" : "Сохранить"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
