"use client";

// Каскадный фильтр периода Q → M → W для колонки инициатив
// (PLAN_PLANNING_REWORK §P2).
//
// Поведение:
//   • Три уровня: Quarter, Month, Week. Каждый — компактный chip-список.
//   • Дефолт — текущая неделя (определяется по дате через findCurrentPeriod).
//   • Активный фильтр = самый глубокий выбранный уровень. Если выбран Q без M/W,
//     фильтр — на квартал. Если выбран M без W — на месяц. И т.д.
//   • Чип «Все» сбрасывает текущий уровень + все нижестоящие.
//   • При выборе Q сбрасываются M и W. При выборе M — сбрасывается W.

import { useMemo } from "react";
import { CalendarRange } from "lucide-react";
import type { PlanningPeriod } from "@/types/planning";
import { buildYearShape, periodParents } from "@/lib/planning-period-utils";

interface Props {
  periods: PlanningPeriod[];
  selectedId: string | null; // активный фильтр-период (week/month/quarter)
  onChange: (id: string | null) => void;
  year?: number;
}

const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function PeriodCascadeFilter({ periods, selectedId, onChange, year }: Props) {
  // Определяем год для отображения — если selected задан, берём его год; иначе аргумент или год первого квартала.
  const displayYear = useMemo(() => {
    if (selectedId) {
      const sel = periods.find((p) => p.id === selectedId);
      if (sel) return sel.year;
    }
    if (year) return year;
    const anyQ = periods.find((p) => p.type === "quarter");
    return anyQ?.year ?? new Date().getUTCFullYear();
  }, [selectedId, year, periods]);

  const shape = useMemo(() => buildYearShape(periods, displayYear), [periods, displayYear]);

  const selected = selectedId ? periods.find((p) => p.id === selectedId) ?? null : null;
  const parents = selected ? periodParents(selected, shape) : { quarter: null, month: null };

  const activeQuarter = parents.quarter ?? (selected?.type === "quarter" ? selected : null);
  const activeMonth = parents.month ?? (selected?.type === "month" ? selected : null);
  const activeWeek = selected?.type === "week" ? selected : null;

  const monthsInQ = activeQuarter?.quarter_n != null
    ? shape.monthsByQuarter.get(activeQuarter.quarter_n) ?? []
    : [];
  const weeksInM = activeMonth?.month_n != null
    ? shape.weeksByMonth.get(activeMonth.month_n) ?? []
    : [];

  const chipBase = "rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums transition-colors";
  const chipActive = "bg-slate-900 text-white";
  const chipInactive = "bg-white text-slate-600 border border-slate-200 hover:border-slate-400";

  return (
    <div className="flex flex-col gap-1 border-b border-slate-100 bg-slate-50/40 px-3 py-1.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-400">
        <CalendarRange className="size-3" /> Период
      </div>

      {/* Quarter row */}
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`${chipBase} ${selectedId === null ? chipActive : chipInactive}`}
          title="Без фильтра — все инициативы"
        >
          Все
        </button>
        {shape.quarters.map((q) => {
          const active = activeQuarter?.id === q.id;
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => onChange(q.id)}
              className={`${chipBase} ${active ? chipActive : chipInactive}`}
              title={`Q${q.quarter_n} ${q.year}`}
            >
              Q{q.quarter_n}
            </button>
          );
        })}
      </div>

      {/* Month row — only if a quarter is active */}
      {activeQuarter && monthsInQ.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pl-3">
          <button
            type="button"
            onClick={() => onChange(activeQuarter.id)}
            className={`${chipBase} ${activeMonth === null ? chipActive : chipInactive}`}
          >
            весь Q{activeQuarter.quarter_n}
          </button>
          {monthsInQ.map((m) => {
            const active = activeMonth?.id === m.id;
            const label = m.month_n != null ? MONTH_SHORT[m.month_n - 1] : "—";
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onChange(m.id)}
                className={`${chipBase} ${active ? chipActive : chipInactive}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Week row — only if a month is active */}
      {activeMonth && weeksInM.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pl-6">
          <button
            type="button"
            onClick={() => onChange(activeMonth.id)}
            className={`${chipBase} ${activeWeek === null ? chipActive : chipInactive}`}
          >
            весь {activeMonth.month_n != null ? MONTH_SHORT[activeMonth.month_n - 1] : "месяц"}
          </button>
          {weeksInM.map((w) => {
            const active = activeWeek?.id === w.id;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => onChange(w.id)}
                className={`${chipBase} ${active ? chipActive : chipInactive}`}
                title={`${w.start_date.slice(5)}–${w.end_date.slice(5)}`}
              >
                W{w.week_n}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
