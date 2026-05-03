"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useBrainStore } from "@/lib/store";
import type { GoalAxis, GoalLevel } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  level: GoalLevel;
  parentId: string | null;
  defaultAxis?: GoalAxis | null;
}

export function CreateGoalDialog({ open, onOpenChange, level, parentId, defaultAxis }: Props) {
  const createGoal = useBrainStore((s) => s.createGoal);
  const goalAxes = useBrainStore((s) => s.goalAxes);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [axis, setAxis] = useState<GoalAxis | null>(defaultAxis ?? null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [autoDecompose, setAutoDecompose] = useState(level === "year" || level === "quarter" || level === "month");
  const [saving, setSaving] = useState(false);

  const canDecompose = level === "year" || level === "quarter" || level === "month";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await createGoal({
        title: title.trim(),
        description: description.trim(),
        level,
        axis,
        parent_id: parentId,
        period_start: periodStart || null,
        period_end: periodEnd || null,
        auto_decompose: canDecompose ? autoDecompose : false,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая цель ({levelLabel(level)})</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium text-slate-600">Название</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Описание</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Ось</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setAxis(null)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                  !axis ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600",
                )}
              >
                Без оси
              </button>
              {goalAxes.map((ax) => (
                <button
                  type="button"
                  key={ax.id}
                  onClick={() => setAxis(ax.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                    axis === ax.id ? "text-white" : "border-slate-200 bg-white text-slate-700",
                  )}
                  style={axis === ax.id ? { backgroundColor: ax.color, borderColor: ax.color } : undefined}
                >
                  {ax.icon} {ax.name}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-slate-600">Начало</label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Конец</label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>
          {canDecompose && (
            <label className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50/40 p-2.5 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={autoDecompose}
                onChange={(e) => setAutoDecompose(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong className="font-medium">Авто-декомпозиция.</strong>{" "}
                {level === "year" && "Создать 4 квартала, 12 месяцев и недели внутри каждого месяца."}
                {level === "quarter" && "Создать 3 месяца и недели внутри каждого."}
                {level === "month" && "Создать недели (Пн–Вс) внутри месяца."}{" "}
                <span className="text-slate-500">К каждой неделе подвяжется метрика «Задачи».</span>
              </span>
            </label>
          )}
          {level === "week" && (
            <p className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500">
              К новой неделе автоматически добавится метрика «Задачи».
            </p>
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

function levelLabel(l: GoalLevel) {
  return { year: "год", quarter: "квартал", month: "месяц", week: "неделя", day: "день" }[l];
}
