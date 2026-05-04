"use client";

import { useMemo, useState } from "react";
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

const RU_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const RU_MONTHS_SHORT = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function iso(y: number, m1: number, d: number): string {
  return `${y}-${pad(m1)}-${pad(d)}`;
}
function lastDay(y: number, m1: number): number {
  return new Date(y, m1, 0).getDate();
}
function parseISO(s: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}
function quarterOfMonth(m1: number): number {
  return Math.floor((m1 - 1) / 3) + 1;
}

export function CreateGoalDialog({ open, onOpenChange, level, parentId, defaultAxis }: Props) {
  const createGoal = useBrainStore((s) => s.createGoal);
  const goalAxes = useBrainStore((s) => s.goalAxes);
  const goals = useBrainStore((s) => s.goals);

  const parent = parentId ? goals.find((g) => g.id === parentId) ?? null : null;
  const parentStart = parseISO(parent?.period_start);
  const parentEnd = parseISO(parent?.period_end);
  const todayY = new Date().getFullYear();
  const todayM = new Date().getMonth() + 1;

  // ---- Level-appropriate period selectors ----
  const [year, setYear] = useState<number>(parentStart?.y ?? todayY);
  const [quarterIdx, setQuarterIdx] = useState<number>(
    parentStart ? quarterOfMonth(parentStart.m) : Math.ceil(todayM / 3),
  );
  // Month picker: index 1..12; for month-level, defaults to today's month or parent quarter's first month.
  const [month, setMonth] = useState<number>(() => {
    if (parentStart && level === "month") {
      // Default to first month of parent quarter
      return parentStart.m;
    }
    return todayM;
  });

  // Week picker: list of Mondays inside the parent month.
  const weeksInMonth: Array<{ start: string; end: string; label: string }> = useMemo(() => {
    if (level !== "week" || !parentStart) return [];
    const y = parentStart.y;
    const m = parentStart.m;
    const last = lastDay(y, m);
    const out: Array<{ start: string; end: string; label: string }> = [];
    // First partial week (1..first Sunday)
    const first = new Date(y, m - 1, 1);
    if (first.getDay() !== 1) {
      const daysToSun = (7 - first.getDay()) % 7;
      const sunDay = 1 + daysToSun;
      out.push({
        start: iso(y, m, 1),
        end: iso(y, m, Math.min(sunDay, last)),
        label: `1 – ${Math.min(sunDay, last)} ${RU_MONTHS_SHORT[m - 1]}`,
      });
    }
    for (let d = 1; d <= last; d++) {
      const dt = new Date(y, m - 1, d);
      if (dt.getDay() === 1) {
        const sun = new Date(dt);
        sun.setDate(sun.getDate() + 6);
        out.push({
          start: iso(y, m, d),
          end: iso(sun.getFullYear(), sun.getMonth() + 1, sun.getDate()),
          label: `${d} ${RU_MONTHS_SHORT[m - 1]} – ${sun.getDate()} ${RU_MONTHS_SHORT[sun.getMonth()]}`,
        });
      }
    }
    return out;
  }, [level, parentStart?.y, parentStart?.m]);
  const [weekIdx, setWeekIdx] = useState<number>(0);

  // Compute final period_start / period_end based on level + selectors.
  const period: { start: string | null; end: string | null } = useMemo(() => {
    if (level === "year") {
      return { start: iso(year, 1, 1), end: iso(year, 12, 31) };
    }
    if (level === "quarter") {
      const y = parentStart?.y ?? year;
      const m1 = (quarterIdx - 1) * 3 + 1;
      const m3 = m1 + 2;
      return { start: iso(y, m1, 1), end: iso(y, m3, lastDay(y, m3)) };
    }
    if (level === "month") {
      const y = parentStart?.y ?? year;
      return { start: iso(y, month, 1), end: iso(y, month, lastDay(y, month)) };
    }
    if (level === "week") {
      const w = weeksInMonth[weekIdx];
      if (!w) return { start: null, end: null };
      return { start: w.start, end: w.end };
    }
    return { start: null, end: null };
  }, [level, year, parentStart?.y, quarterIdx, month, weekIdx, weeksInMonth]);

  // Title default — auto-derive from period if user hasn't typed anything.
  const autoTitle: string = useMemo(() => {
    if (level === "year") return `${year}`;
    if (level === "quarter") return `Q${quarterIdx} ${parentStart?.y ?? year}`;
    if (level === "month") return `${RU_MONTHS[month - 1]} ${parentStart?.y ?? year}`;
    if (level === "week") return weeksInMonth[weekIdx]?.label ?? "";
    return "";
  }, [level, year, quarterIdx, month, weekIdx, weeksInMonth, parentStart?.y]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [axis, setAxis] = useState<GoalAxis | null>(defaultAxis ?? null);
  const [autoDecompose, setAutoDecompose] = useState(level === "year" || level === "quarter" || level === "month");
  const [saving, setSaving] = useState(false);

  const canDecompose = level === "year" || level === "quarter" || level === "month";
  const finalTitle = title.trim() || autoTitle.trim();
  const canSubmit = !!finalTitle && !!period.start && !saving;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      // Close immediately — createGoal is now optimistic + bg refresh.
      onOpenChange(false);
      void createGoal({
        title: finalTitle,
        description: description.trim(),
        level,
        axis,
        parent_id: parentId,
        period_start: period.start,
        period_end: period.end,
        auto_decompose: canDecompose ? autoDecompose : false,
      });
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
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={autoTitle || "Заголовок цели"}
              autoFocus
            />
            {!title && autoTitle && (
              <p className="mt-0.5 text-[10px] text-slate-400">Если оставить пустым — будет: «{autoTitle}»</p>
            )}
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

          {/* Level-specific period selectors */}
          {level === "year" && (
            <div>
              <label className="text-xs font-medium text-slate-600">Год</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700"
              >
                {Array.from({ length: 11 }, (_, i) => todayY - 3 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}

          {level === "quarter" && (
            <div>
              <label className="text-xs font-medium text-slate-600">
                Квартал {parentStart && <span className="text-slate-400">· {parentStart.y}</span>}
              </label>
              <div className="mt-1 grid grid-cols-4 gap-1">
                {[1, 2, 3, 4].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuarterIdx(q)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs font-medium transition",
                      quarterIdx === q
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                    )}
                  >
                    Q{q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {level === "month" && (
            <div>
              <label className="text-xs font-medium text-slate-600">
                Месяц {parentStart && <span className="text-slate-400">· {parentStart.y}</span>}
              </label>
              <div className="mt-1 grid grid-cols-4 gap-1">
                {RU_MONTHS_SHORT.map((nm, i) => {
                  const m1 = i + 1;
                  // Constrain to parent quarter range when applicable.
                  const inRange = !parent || (parentStart && parentEnd
                    ? m1 >= parentStart.m && m1 <= parentEnd.m
                    : true);
                  return (
                    <button
                      key={nm}
                      type="button"
                      disabled={!inRange}
                      onClick={() => setMonth(m1)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs font-medium transition",
                        month === m1
                          ? "border-slate-900 bg-slate-900 text-white"
                          : !inRange
                            ? "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                      )}
                    >
                      {nm}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {level === "week" && (
            <div>
              <label className="text-xs font-medium text-slate-600">
                Неделя {parentStart && <span className="text-slate-400">· {RU_MONTHS[parentStart.m - 1]} {parentStart.y}</span>}
              </label>
              {weeksInMonth.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">Сначала выберите месяц-родитель</p>
              ) : (
                <div className="mt-1 flex flex-col gap-1">
                  {weeksInMonth.map((w, i) => (
                    <button
                      key={w.start}
                      type="button"
                      onClick={() => setWeekIdx(i)}
                      className={cn(
                        "rounded-md border px-2 py-1.5 text-left text-xs font-medium transition",
                        weekIdx === i
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                      )}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

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
            <Button type="submit" disabled={!canSubmit}>
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
