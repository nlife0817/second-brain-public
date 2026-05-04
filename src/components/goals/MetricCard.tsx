"use client";

import { useMemo, useState } from "react";
import { useBrainStore } from "@/lib/store";
import {
  METRIC_KIND_CONFIG, GOAL_LEVEL_CONFIG,
  type GoalMetric, type ChecklistItem, type GoalLevel,
} from "@/types";
import { metricProgress, formatMetricValue } from "@/lib/goals-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, Check, History, Layers, Split } from "lucide-react";
import { cn } from "@/lib/utils";
import { SnapshotHistory } from "./SnapshotHistory";
import { DistributeMetricDialog } from "./DistributeMetricDialog";

const NEXT_LEVEL: Record<GoalLevel, GoalLevel | null> = {
  year: "quarter",
  quarter: "month",
  month: "week",
  week: null,
};

interface Props {
  goalId: string;
  metric: GoalMetric;
  axisColor: string;
}

export function MetricCard({ goalId, metric, axisColor }: Props) {
  const updateMetric = useBrainStore((s) => s.updateMetric);
  const deleteMetric = useBrainStore((s) => s.deleteMetric);
  const recordSnapshot = useBrainStore((s) => s.recordSnapshot);
  const goals = useBrainStore((s) => s.goals);

  const cfg = METRIC_KIND_CONFIG[metric.kind];
  const pct = Math.round(metricProgress(metric) * 100);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [distributeOpen, setDistributeOpen] = useState(false);
  const supportsHistory = metric.kind === "numeric";

  const parentGoal = useMemo(() => goals.find((g) => g.id === goalId) ?? null, [goals, goalId]);

  // Lazy auto-freeze: when the goal's period_end is in the past we treat the
  // KR as closed and render plan/fact instead of the live editor. Editing is
  // still allowed (postfactum corrections show up in history).
  const isClosed = useMemo(() => {
    const end = parentGoal?.period_end;
    if (!end) return false;
    const endDay = end.length >= 10 ? end.slice(0, 10) : end;
    const today = new Date().toISOString().slice(0, 10);
    return endDay < today;
  }, [parentGoal?.period_end]);

  // Direct children of this goal at the next level — drives the "Распределить"
  // button visibility and the divergence indicator.
  const directChildGoals = useMemo(() => {
    if (!parentGoal) return [];
    const childLevel = NEXT_LEVEL[parentGoal.level];
    if (!childLevel) return [];
    return goals.filter((g) => g.parent_id === goalId && g.level === childLevel);
  }, [goals, goalId, parentGoal]);

  // Has any descendant KR pointing back at this one? When yes, current_value
  // is overridden by the rolled-up effective_current — surface that to user.
  const childKRs = useMemo(() => {
    const out: GoalMetric[] = [];
    for (const g of goals) {
      for (const m of g.metrics ?? []) {
        if (m.parent_metric_id === metric.id) out.push(m);
      }
    }
    return out;
  }, [goals, metric.id]);
  const hasChildKRs = childKRs.length > 0;
  const overrideShown = hasChildKRs
    && metric.effective_current != null
    && metric.current_value != null
    && Number(metric.effective_current) !== Number(metric.current_value);

  // Distribute is only meaningful for numeric/checklist/boolean — tasks-KR
  // cascades automatically via parent_metric_id and shares categories.
  const canDistribute = metric.kind === "numeric"
    && parentGoal != null
    && NEXT_LEVEL[parentGoal.level] != null
    && directChildGoals.length > 0;

  // Sum of direct-child plans for divergence indicator. Only count children
  // that live on a goal in directChildGoals (one level down).
  const childPlanSum = useMemo(() => {
    if (metric.kind !== "numeric") return null;
    const childGoalIds = new Set(directChildGoals.map((g) => g.id));
    let sum: number | null = null;
    let any = false;
    for (const km of childKRs) {
      if (!childGoalIds.has(km.goal_id)) continue;
      if (km.target_value == null) continue;
      sum = (sum ?? 0) + Number(km.target_value);
      any = true;
    }
    return any ? sum : null;
  }, [childKRs, directChildGoals, metric.kind]);
  const planDiff = childPlanSum != null && metric.target_value != null
    ? childPlanSum - Number(metric.target_value)
    : null;

  return (
    <div className="mb-2 rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex items-start gap-2">
        <span className="text-base leading-none">{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-slate-900">{metric.title}</span>
            {isClosed && (
              <span
                className="rounded bg-slate-200 px-1 py-0.5 text-[9px] font-medium text-slate-600"
                title="Период закрыт — показано план vs факт"
              >
                закрыто
              </span>
            )}
            {hasChildKRs && (
              <span
                className="inline-flex items-center gap-0.5 rounded bg-violet-50 px-1 py-0.5 text-[9px] font-medium text-violet-600"
                title="Считается из дочерних KR"
              >
                <Layers className="size-2.5" />
                агрегат
              </span>
            )}
            {metric.parent_metric_id && (
              <span
                className="rounded bg-slate-100 px-1 py-0.5 text-[9px] font-medium text-slate-500"
                title="Наследник родительского KR"
              >
                ↑ от родителя
              </span>
            )}
            {metric.kind === "tasks" && (metric.tasks_category_ids?.length ?? 0) > 0 && (
              <span
                className="rounded bg-emerald-50 px-1 py-0.5 text-[9px] font-medium text-emerald-600"
                title="Считается автоматически по категориям задач"
              >
                авто
              </span>
            )}
          </div>
          {isClosed && metric.kind === "numeric" ? (
            <PlanFactLine metric={metric} />
          ) : (
            <div className="text-[10px] tabular-nums text-slate-500">
              {formatMetricValue(metric)}
              {overrideShown && (
                <span className="ml-1 text-slate-400">
                  · ручное: {fmtNum(metric.current_value)}
                </span>
              )}
            </div>
          )}
        </div>
        <span className="text-xs font-semibold tabular-nums text-slate-700">{pct}%</span>
        {canDistribute && (
          <button
            onClick={() => setDistributeOpen(true)}
            className="text-slate-300 hover:text-violet-600"
            title={`Распределить по ${GOAL_LEVEL_CONFIG[NEXT_LEVEL[parentGoal!.level]!].label.toLowerCase()}ам`}
          >
            <Split className="size-3.5" />
          </button>
        )}
        {supportsHistory && (
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className={cn(
              "text-slate-300 hover:text-violet-600",
              historyOpen && "text-violet-600",
            )}
            title="История значений"
          >
            <History className="size-3.5" />
          </button>
        )}
        <button
          onClick={async () => {
            if (confirm(`Удалить метрику «${metric.title}»?`)) {
              await deleteMetric(goalId, metric.id);
            }
          }}
          className="text-slate-300 hover:text-red-500"
          title="Удалить метрику"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {planDiff != null && Math.abs(planDiff) > 0.0001 && (
        <div className="mt-1 flex items-center justify-between rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
          <span>Перепланирование</span>
          <span className="tabular-nums font-medium">
            {planDiff > 0 ? "+" : ""}{planDiff.toLocaleString("ru-RU")}
            {metric.unit ? ` ${metric.unit}` : ""}
            <span className="ml-1 text-amber-500">
              (дети: {childPlanSum?.toLocaleString("ru-RU")} / план: {Number(metric.target_value).toLocaleString("ru-RU")})
            </span>
          </span>
        </div>
      )}

      <div className="mt-2 h-1 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: axisColor }}
        />
      </div>

      <div className="mt-2.5">
        {metric.kind === "numeric" && (
          <NumericEditor
            metric={metric}
            onSnapshot={(v) => recordSnapshot(goalId, metric.id, v)}
          />
        )}
        {metric.kind === "checklist" && (
          <ChecklistEditor
            metric={metric}
            onUpdate={(items) => updateMetric(goalId, metric.id, { payload: { items } })}
          />
        )}
        {metric.kind === "boolean" && (
          <BooleanEditor
            metric={metric}
            onToggle={(done) => updateMetric(goalId, metric.id, { payload: { done } })}
          />
        )}
        {metric.kind === "tasks" && (
          <p className="text-[11px] text-slate-400">
            Считается по задачам в выбранных категориях за период цели.
          </p>
        )}
      </div>

      {historyOpen && supportsHistory && (
        <SnapshotHistory goalId={goalId} metric={metric} onClose={() => setHistoryOpen(false)} />
      )}

      {distributeOpen && parentGoal && (
        <DistributeMetricDialog
          open={distributeOpen}
          onOpenChange={setDistributeOpen}
          parentGoal={parentGoal}
          parentMetric={metric}
        />
      )}
    </div>
  );
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("ru-RU") : "—";
}

function PlanFactLine({ metric }: { metric: GoalMetric }) {
  const fact = metric.effective_current ?? metric.current_value;
  const plan = metric.target_value;
  const diffPct = plan != null && Number(plan) !== 0 && fact != null
    ? Math.round(((Number(fact) - Number(plan)) / Number(plan)) * 100)
    : null;
  const unit = metric.unit ? ` ${metric.unit}` : "";
  return (
    <div className="text-[10px] tabular-nums text-slate-500">
      План: <span className="text-slate-700">{fmtNum(plan)}{unit}</span>
      <span className="mx-1 text-slate-300">·</span>
      Факт: <span className="text-slate-700">{fmtNum(fact)}{unit}</span>
      {diffPct != null && (
        <span className={cn(
          "ml-1",
          diffPct >= 0 ? "text-emerald-600" : "text-rose-500",
        )}>
          {diffPct >= 0 ? "+" : ""}{diffPct}%
        </span>
      )}
    </div>
  );
}

function NumericEditor({ metric, onSnapshot }: { metric: GoalMetric; onSnapshot: (v: number) => void }) {
  const [value, setValue] = useState(metric.current_value?.toString() ?? "");
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Текущее"
        className="h-7 text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={() => {
          const n = Number(value);
          if (Number.isFinite(n)) onSnapshot(n);
        }}
      >
        <Check className="size-3.5" />
      </Button>
    </div>
  );
}

function ChecklistEditor({
  metric,
  onUpdate,
}: {
  metric: GoalMetric;
  onUpdate: (items: ChecklistItem[]) => void;
}) {
  const items = metric.payload?.items ?? [];
  const [newItem, setNewItem] = useState("");

  return (
    <div className="space-y-1">
      {items.map((it, idx) => (
        <label
          key={idx}
          className={cn(
            "flex items-center gap-1.5 text-[11px]",
            it.done && "text-slate-400 line-through",
          )}
        >
          <input
            type="checkbox"
            checked={it.done}
            onChange={(e) => {
              const next = items.map((x, i) => (i === idx ? { ...x, done: e.target.checked } : x));
              onUpdate(next);
            }}
          />
          <span className="flex-1">{it.title}</span>
          <button
            onClick={(e) => {
              e.preventDefault();
              onUpdate(items.filter((_, i) => i !== idx));
            }}
            className="text-slate-300 hover:text-red-500"
          >
            ✕
          </button>
        </label>
      ))}
      <div className="flex items-center gap-1">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newItem.trim()) {
              onUpdate([...items, { title: newItem.trim(), done: false }]);
              setNewItem("");
            }
          }}
          placeholder="Добавить пункт"
          className="h-7 text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() => {
            if (newItem.trim()) {
              onUpdate([...items, { title: newItem.trim(), done: false }]);
              setNewItem("");
            }
          }}
        >
          <Plus className="size-3" />
        </Button>
      </div>
    </div>
  );
}

function BooleanEditor({
  metric,
  onToggle,
}: {
  metric: GoalMetric;
  onToggle: (done: boolean) => void;
}) {
  const done = !!metric.payload?.done;
  return (
    <Button
      size="sm"
      variant={done ? "default" : "outline"}
      className="h-7 w-full text-xs"
      onClick={() => onToggle(!done)}
    >
      {done ? "✓ Готово" : "Отметить как сделано"}
    </Button>
  );
}
