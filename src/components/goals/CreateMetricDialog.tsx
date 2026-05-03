"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useBrainStore } from "@/lib/store";
import { METRIC_KIND_CONFIG, type MetricKind, type CreateMetricPayload } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  goalId: string;
}

export function CreateMetricDialog({ open, onOpenChange, goalId }: Props) {
  const createMetric = useBrainStore((s) => s.createMetric);
  const [kind, setKind] = useState<MetricKind>("numeric");
  const [title, setTitle] = useState("");
  const [unit, setUnit] = useState("");
  const [target, setTarget] = useState("");
  const [start, setStart] = useState("");
  const [direction, setDirection] = useState<"up" | "down">("up");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const payload: CreateMetricPayload = {
        kind,
        title: title.trim(),
        unit: unit.trim() || null,
        direction,
      };
      if (kind === "numeric" || kind === "counter") {
        payload.target_value = target ? Number(target) : null;
        if (kind === "numeric" && direction === "down") {
          payload.start_value = start ? Number(start) : null;
          payload.current_value = start ? Number(start) : null;
        } else {
          payload.current_value = 0;
        }
      } else if (kind === "checklist") {
        payload.payload = { items: [] };
      } else if (kind === "boolean") {
        payload.payload = { done: false };
      }
      await createMetric(goalId, payload);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая метрика (KR)</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
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

          <div>
            <label className="text-xs font-medium text-slate-600">Название</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>

          {(kind === "numeric" || kind === "counter") && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-600">Цель</label>
                  <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Единица</label>
                  <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="₽, кг, шт" />
                </div>
              </div>
              {kind === "numeric" && (
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
                  {direction === "down" && (
                    <div className="mt-2">
                      <label className="text-xs font-medium text-slate-600">Стартовое значение</label>
                      <Input type="number" value={start} onChange={(e) => setStart(e.target.value)} />
                    </div>
                  )}
                </div>
              )}
            </>
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
