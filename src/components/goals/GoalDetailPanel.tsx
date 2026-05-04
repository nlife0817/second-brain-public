"use client";

import { useState } from "react";
import { useBrainStore } from "@/lib/store";
import {
  GOAL_LEVEL_CONFIG, GOAL_STATUS_CONFIG,
  type GoalFull, type GoalStatus,
} from "@/types";
import { lookupAxis } from "@/lib/goal-axes";
import { MetricCard } from "./MetricCard";
import { CreateMetricDialog } from "./CreateMetricDialog";
import { LinkedTasksPanel } from "./LinkedTasksPanel";
import { LinkedGoalsSection } from "./LinkedGoalsSection";
import { ClientRevenueSection } from "./ClientRevenueSection";
import { ClientRevenueAggregateSection } from "./ClientRevenueAggregateSection";
import { CommentsList } from "@/components/comments/CommentsList";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  goal: GoalFull | null;
}

export function GoalDetailPanel({ goal }: Props) {
  const deleteGoal = useBrainStore((s) => s.deleteGoal);
  const goalAxes = useBrainStore((s) => s.goalAxes);
  const [editing, setEditing] = useState(false);
  const [createMetricOpen, setCreateMetricOpen] = useState(false);

  if (!goal) {
    return (
      <aside className="w-[380px] shrink-0 border-l border-slate-200 bg-white">
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">
          Выберите цель в любой колонке, чтобы увидеть метрики и связанные задачи.
        </div>
      </aside>
    );
  }

  const ax = lookupAxis(goalAxes, goal.axis);
  const pct = Math.round(goal.progress * 100);

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-center gap-2">
          {ax && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              style={{ backgroundColor: ax.bg, color: ax.color }}
            >
              {ax.icon} {ax.name}
            </span>
          )}
          <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
            {GOAL_LEVEL_CONFIG[goal.level].label}
          </span>
          <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-400">
            {GOAL_STATUS_CONFIG[goal.status as GoalStatus].label}
          </span>
        </div>

        {editing ? (
          <EditGoalForm goal={goal} onClose={() => setEditing(false)} />
        ) : (
          <>
            <h2
              className="mt-2 cursor-pointer text-base font-semibold text-slate-900"
              onClick={() => setEditing(true)}
              title="Кликните для редактирования"
            >
              {goal.title}
            </h2>
            {goal.description && (
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-500">
                {goal.description}
              </p>
            )}
            {(goal.period_start || goal.period_end) && (
              <p className="mt-1 text-[11px] text-slate-400">
                {goal.period_start ?? "—"} → {goal.period_end ?? "—"}
              </p>
            )}
          </>
        )}

        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, backgroundColor: ax?.color ?? "#64748b" }}
            />
          </div>
          <span className="w-10 text-right text-xs font-semibold tabular-nums text-slate-700">{pct}%</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <section className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Метрики (KR)
            </h3>
            <button
              onClick={() => setCreateMetricOpen(true)}
              className="flex size-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              title="Добавить KR"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          {goal.metrics.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
              Нет метрик. Прогресс берётся из дочерних целей.
            </div>
          )}
          {goal.metrics.map((m) => (
            <MetricCard key={m.id} goalId={goal.id} metric={m} axisColor={ax?.color ?? "#64748b"} />
          ))}
        </section>

        <section className="border-t border-slate-200 p-4">
          {goal.level === "week"
            ? <ClientRevenueSection goal={goal} />
            : <ClientRevenueAggregateSection goal={goal} />}
        </section>

        <section className="border-t border-slate-200 p-4">
          <LinkedTasksPanel goalId={goal.id} />
        </section>

        <section className="border-t border-slate-200 p-4">
          <LinkedGoalsSection goal={goal} />
        </section>

        <section className="border-t border-slate-200 p-4">
          <CommentsList entityType="goal" entityId={goal.id} />
        </section>
      </div>

      <div className="border-t border-slate-200 p-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center text-xs text-red-500 hover:bg-red-50 hover:text-red-600"
          onClick={async () => {
            if (confirm(`Удалить цель «${goal.title}»? Все её KR и подцели будут удалены.`)) {
              await deleteGoal(goal.id);
            }
          }}
        >
          <Trash2 className="mr-1 size-3.5" /> Удалить цель
        </Button>
      </div>

      {createMetricOpen && (
        <CreateMetricDialog
          open={createMetricOpen}
          onOpenChange={setCreateMetricOpen}
          goalId={goal.id}
        />
      )}
    </aside>
  );
}

function EditGoalForm({ goal, onClose }: { goal: GoalFull; onClose: () => void }) {
  const updateGoal = useBrainStore((s) => s.updateGoal);
  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description);
  const [saving, setSaving] = useState(false);

  return (
    <div className="mt-2 flex flex-col gap-2">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>Отмена</Button>
        <Button
          size="sm"
          disabled={saving || !title.trim()}
          onClick={async () => {
            setSaving(true);
            await updateGoal(goal.id, { title: title.trim(), description });
            setSaving(false);
            onClose();
          }}
        >
          Сохранить
        </Button>
      </div>
    </div>
  );
}
