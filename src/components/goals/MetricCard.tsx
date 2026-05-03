"use client";

import { useState } from "react";
import { useBrainStore } from "@/lib/store";
import { METRIC_KIND_CONFIG, type GoalMetric, type ChecklistItem } from "@/types";
import { metricProgress, formatMetricValue } from "@/lib/goals-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, Check, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { SnapshotHistory } from "./SnapshotHistory";

interface Props {
  goalId: string;
  metric: GoalMetric;
  axisColor: string;
}

export function MetricCard({ goalId, metric, axisColor }: Props) {
  const updateMetric = useBrainStore((s) => s.updateMetric);
  const deleteMetric = useBrainStore((s) => s.deleteMetric);
  const recordSnapshot = useBrainStore((s) => s.recordSnapshot);

  const cfg = METRIC_KIND_CONFIG[metric.kind];
  const pct = Math.round(metricProgress(metric) * 100);
  const [historyOpen, setHistoryOpen] = useState(false);
  const supportsHistory = metric.kind === "numeric" || metric.kind === "counter";

  return (
    <div className="mb-2 rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex items-start gap-2">
        <span className="text-base leading-none">{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-slate-900">{metric.title}</span>
          </div>
          <div className="text-[10px] tabular-nums text-slate-500">{formatMetricValue(metric)}</div>
        </div>
        <span className="text-xs font-semibold tabular-nums text-slate-700">{pct}%</span>
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

      <div className="mt-2 h-1 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: axisColor }}
        />
      </div>

      <div className="mt-2.5">
        {(metric.kind === "numeric" || metric.kind === "counter") && (
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
            Авто-прогресс. Привяжите задачи в секции ниже.
          </p>
        )}
      </div>

      {historyOpen && supportsHistory && (
        <SnapshotHistory goalId={goalId} metric={metric} onClose={() => setHistoryOpen(false)} />
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
