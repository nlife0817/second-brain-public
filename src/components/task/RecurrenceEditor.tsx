"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RecurrenceFreq, RecurrenceRule } from "@/types";
import { describeRule, generateInstanceDates, MAX_INSTANCES } from "@/lib/recurrence";

const PRESETS: { id: RecurrenceFreq | "custom"; label: string }[] = [
  { id: "daily", label: "Ежедневно" },
  { id: "weekdays", label: "По будням" },
  { id: "weekly", label: "Еженедельно" },
  { id: "monthly", label: "Ежемесячно" },
  { id: "yearly", label: "Ежегодно" },
  { id: "custom", label: "Кастом" },
];

const WEEKDAYS = [
  { id: 1, label: "Пн" }, { id: 2, label: "Вт" }, { id: 3, label: "Ср" },
  { id: 4, label: "Чт" }, { id: 5, label: "Пт" }, { id: 6, label: "Сб" },
  { id: 0, label: "Вс" },
];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface RecurrenceEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Initial rule (when editing an existing series). When omitted — sensible defaults. */
  initial?: Partial<RecurrenceRule> | null;
  /** Default start_date when creating from a task with a due date. */
  defaultStartDate?: string | null;
  /** "create" — make a new series; "edit" — modify an existing one. */
  mode: "create" | "edit";
  onSubmit: (rule: RecurrenceRule) => Promise<void> | void;
  /** When mode='edit' — show "delete series" button. */
  onDelete?: () => Promise<void> | void;
}

export function RecurrenceEditor({
  open, onOpenChange, initial, defaultStartDate, mode, onSubmit, onDelete,
}: RecurrenceEditorProps) {
  const [preset, setPreset] = useState<RecurrenceFreq | "custom">(initial?.freq ?? "daily");
  const [interval, setInterval] = useState<number>(initial?.interval ?? 1);
  const [byweekday, setByweekday] = useState<number[]>(initial?.byweekday ?? []);
  const [bymonthday, setBymonthday] = useState<number | "">(initial?.bymonthday ?? "");
  const [startDate, setStartDate] = useState<string>(initial?.start_date ?? defaultStartDate ?? todayStr());
  const [untilDate, setUntilDate] = useState<string>(initial?.until_date ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset fields when dialog reopens.
  useEffect(() => {
    if (!open) return;
    setPreset(initial?.freq ?? "daily");
    setInterval(initial?.interval ?? 1);
    setByweekday(initial?.byweekday ?? []);
    setBymonthday(initial?.bymonthday ?? "");
    setStartDate(initial?.start_date ?? defaultStartDate ?? todayStr());
    setUntilDate(initial?.until_date ?? "");
    setError(null);
  }, [open, initial, defaultStartDate]);

  const effectiveFreq: RecurrenceFreq = preset === "custom" ? "daily" : preset;
  const showWeekdays = preset === "weekly";
  const showMonthDay = preset === "monthly";
  const showInterval = preset === "custom" || preset === "weekly" || preset === "monthly" || preset === "yearly" || preset === "daily";

  const draftRule: RecurrenceRule = useMemo(() => ({
    freq: effectiveFreq,
    interval: Math.max(1, Math.floor(Number(interval) || 1)),
    byweekday: showWeekdays && byweekday.length > 0 ? byweekday : null,
    bymonthday: showMonthDay && bymonthday !== "" ? Number(bymonthday) : null,
    start_date: startDate,
    until_date: untilDate || startDate,
  }), [effectiveFreq, interval, byweekday, bymonthday, showWeekdays, showMonthDay, startDate, untilDate]);

  const preview = useMemo(() => {
    if (!startDate || !untilDate) return { count: 0, dates: [] as string[], err: null as string | null };
    if (untilDate < startDate) return { count: 0, dates: [], err: "Дата окончания раньше начала" };
    try {
      const dates = generateInstanceDates(draftRule);
      if (dates.length === 0) return { count: 0, dates: [], err: "Правило не порождает экземпляров" };
      if (dates.length > MAX_INSTANCES) return { count: dates.length, dates: [], err: `Слишком много (${dates.length} > ${MAX_INSTANCES})` };
      return { count: dates.length, dates: dates.slice(0, 5), err: null };
    } catch (e) {
      return { count: 0, dates: [], err: e instanceof Error ? e.message : "Ошибка правила" };
    }
  }, [draftRule, startDate, untilDate]);

  const toggleWeekday = (id: number) => {
    setByweekday((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].sort((a, b) => a - b));
  };

  const handleSubmit = async () => {
    if (preview.err) {
      setError(preview.err);
      return;
    }
    if (!untilDate) {
      setError("Укажите дату окончания серии");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(draftRule);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!confirm("Удалить все будущие экземпляры серии? Прошлые задачи останутся.")) return;
    setSubmitting(true);
    try {
      await onDelete();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-full p-5 bg-white z-[70]" showCloseButton>
        <DialogTitle className="text-base font-semibold text-slate-900">
          {mode === "create" ? "Сделать задачу повторяющейся" : "Изменить серию"}
        </DialogTitle>
        {mode === "edit" && (
          <p className="text-xs text-slate-500 -mt-1">
            Изменения применятся ко всем будущим экземплярам. Прошлые задачи останутся как есть.
          </p>
        )}

        <div className="flex flex-col gap-4 mt-2">
          {/* Preset selector */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Регулярность</span>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs transition-colors",
                    preset === p.id
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom — freq + interval */}
          {preset === "custom" && (
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1.5 flex-1">
                <span className="text-xs font-medium text-slate-600">Каждые</span>
                <Input
                  type="number"
                  min={1}
                  value={interval}
                  onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))}
                  className="h-8"
                />
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <span className="text-xs font-medium text-slate-600">Период</span>
                <Select value={effectiveFreq} onValueChange={(v) => setPreset(v as RecurrenceFreq)}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">дн.</SelectItem>
                    <SelectItem value="weekly">нед.</SelectItem>
                    <SelectItem value="monthly">мес.</SelectItem>
                    <SelectItem value="yearly">г.</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Interval for non-custom presets > 1 (excl. weekdays) */}
          {preset !== "custom" && preset !== "weekdays" && showInterval && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Интервал</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">каждые</span>
                <Input
                  type="number"
                  min={1}
                  value={interval}
                  onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))}
                  className="h-8 w-20"
                />
                <span className="text-xs text-slate-500">
                  {preset === "daily" && "дн."}
                  {preset === "weekly" && "нед."}
                  {preset === "monthly" && "мес."}
                  {preset === "yearly" && "г."}
                </span>
              </div>
            </div>
          )}

          {/* Weekday selection */}
          {showWeekdays && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Дни недели</span>
              <div className="flex gap-1">
                {WEEKDAYS.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => toggleWeekday(w.id)}
                    className={cn(
                      "h-8 w-9 rounded-md border text-xs transition-colors",
                      byweekday.includes(w.id)
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    )}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-slate-400">
                Если не выбрано — день недели берётся из даты начала.
              </span>
            </div>
          )}

          {/* Day of month */}
          {showMonthDay && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">День месяца</span>
              <Input
                type="number"
                min={1}
                max={31}
                placeholder="по умолчанию — день из даты начала"
                value={bymonthday}
                onChange={(e) => {
                  const v = e.target.value;
                  setBymonthday(v === "" ? "" : Math.max(1, Math.min(31, Number(v) || 1)));
                }}
                className="h-8 w-32"
              />
              <span className="text-[10px] text-slate-400">
                Если месяц короче — будет последний день месяца (29/30 февраля → 28/29).
              </span>
            </div>
          )}

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Начало</span>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-8"
                disabled={mode === "edit"}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">До (включительно)</span>
              <Input
                type="date"
                value={untilDate}
                min={startDate}
                onChange={(e) => setUntilDate(e.target.value)}
                className="h-8"
              />
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
            {preview.err ? (
              <span className="text-red-600">{preview.err}</span>
            ) : preview.count > 0 ? (
              <>
                <div className="font-medium text-slate-700">{describeRule(draftRule)}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Будет создано экземпляров: {preview.count}
                  {preview.dates.length > 0 && (
                    <>: {preview.dates.map((d) => d.split("-").reverse().join(".")).slice(0, 3).join(", ")}{preview.count > 3 ? "…" : ""}</>
                  )}
                </div>
              </>
            ) : (
              <span className="text-slate-400">Заполните даты и параметры — здесь появится предпросмотр.</span>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div>
              {mode === "edit" && onDelete && (
                <Button variant="ghost" size="sm" onClick={handleDelete} disabled={submitting} className="text-red-600 hover:bg-red-50 hover:text-red-700">
                  Удалить серию
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
                Отмена
              </Button>
              <Button size="sm" onClick={handleSubmit} disabled={submitting || !!preview.err || preview.count === 0}>
                {mode === "create" ? "Создать серию" : "Сохранить"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
