"use client";

// Компактный grid 4 quarter × до 13 недель — пикер недельного диапазона
// для инициативы (PLAN_PLANNING_REWORK §P2).
//
// Режимы:
//   mode="range" — два клика выбирают start..end. Кликнули на ту же ячейку → diапазон 1 неделя.
//                 Клик за пределами текущего диапазона перестраивает (новый start).
//   mode="single" — один клик; и start, и end ставятся в одну неделю.
//
// Подсветка:
//   • bg-slate-100 — пусто
//   • bg-blue-100  — выбранный диапазон
//   • bg-blue-600/text-white — границы диапазона (start или end)
//   • ring-2 ring-amber-400 — текущая неделя (NOW)

import { useMemo, useState } from "react";
import type { PlanningPeriod } from "@/types/planning";
import { buildYearShape, findCurrentPeriod } from "@/lib/planning-period-utils";

interface Props {
  periods: PlanningPeriod[];
  startId: string | null;
  endId: string | null;
  onChange: (start: string | null, end: string | null) => void;
  // Какой год показывать. Если не задан — берём год текущей недели или первого квартала.
  year?: number;
  mode?: "range" | "single";
  className?: string;
}

export function WeekGridPicker({ periods, startId, endId, onChange, year, mode = "range", className }: Props) {
  const nowPeriod = useMemo(() => findCurrentPeriod(periods, "week"), [periods]);
  const fallbackYear = nowPeriod?.year ?? periods.find((p) => p.type === "quarter")?.year ?? new Date().getUTCFullYear();
  const [displayYear, setDisplayYear] = useState<number>(year ?? fallbackYear);

  const shape = useMemo(() => buildYearShape(periods, displayYear), [periods, displayYear]);
  const yearsAvailable = useMemo(() => {
    const set = new Set<number>();
    for (const p of periods) if (p.type === "week") set.add(p.year);
    return Array.from(set).sort((a, b) => a - b);
  }, [periods]);

  const start = startId ? periods.find((p) => p.id === startId) ?? null : null;
  const end = endId ? periods.find((p) => p.id === endId) ?? null : null;
  const startTs = start ? new Date(start.start_date).getTime() : null;
  const endTs = end ? new Date(end.end_date).getTime() : null;
  const minTs = startTs != null && endTs != null ? Math.min(startTs, endTs) : (startTs ?? endTs);
  const maxTs = startTs != null && endTs != null ? Math.max(startTs, endTs) : (startTs ?? endTs);

  // pending = state машины «клик-клик» в range mode
  const [pendingStart, setPendingStart] = useState<string | null>(null);

  const isInRange = (w: PlanningPeriod): boolean => {
    if (minTs == null || maxTs == null) return false;
    const wMid = (new Date(w.start_date).getTime() + new Date(w.end_date).getTime()) / 2;
    return wMid >= minTs && wMid <= maxTs;
  };

  const handleClick = (w: PlanningPeriod) => {
    if (mode === "single") {
      onChange(w.id, w.id);
      return;
    }
    // range mode
    if (pendingStart === null) {
      // первый клик: ставим start (и end = start, чтобы UI сразу что-то показывал).
      setPendingStart(w.id);
      onChange(w.id, w.id);
    } else {
      const a = periods.find((p) => p.id === pendingStart);
      if (!a) { setPendingStart(null); return; }
      const aTs = new Date(a.start_date).getTime();
      const bTs = new Date(w.start_date).getTime();
      const [s, e] = aTs <= bTs ? [a, w] : [w, a];
      onChange(s.id, e.id);
      setPendingStart(null);
    }
  };

  const reset = () => {
    setPendingStart(null);
    onChange(null, null);
  };

  // Quick presets: end = base + offset. Base = start (если задан) | now-week | первая
  // неделя текущего displayYear. start не трогаем; в single mode — выставляем обоим
  // одну и ту же неделю (offset от now).
  const findWeekAtDaysOffset = (baseDate: string, days: number): PlanningPeriod | null => {
    const target = new Date(baseDate).getTime() + days * 86400000;
    let best: PlanningPeriod | null = null;
    let bestDelta = Infinity;
    for (const w of periods) {
      if (w.type !== "week") continue;
      const wMid = (new Date(w.start_date).getTime() + new Date(w.end_date).getTime()) / 2;
      const d = Math.abs(wMid - target);
      if (d < bestDelta) { best = w; bestDelta = d; }
    }
    return best;
  };

  const applyPreset = (days: number) => {
    const baseStart = start ?? nowPeriod ?? periods.find((p) => p.type === "week" && p.year === displayYear) ?? null;
    if (!baseStart) return;
    const target = findWeekAtDaysOffset(baseStart.start_date, days);
    if (!target) return;
    if (mode === "single") {
      onChange(target.id, target.id);
    } else {
      onChange(baseStart.id, target.id);
    }
    setPendingStart(null);
  };

  const PRESETS: Array<{ label: string; days: number }> = [
    { label: "+1w",  days: 7 },
    { label: "+2w",  days: 14 },
    { label: "+1m",  days: 30 },
    { label: "+3m",  days: 90 },
    { label: "+6m",  days: 180 },
  ];

  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {yearsAvailable.length > 1 && yearsAvailable.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setDisplayYear(y)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                y === displayYear ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          {nowPeriod && nowPeriod.year === displayYear && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-sm ring-2 ring-amber-400" />
              сейчас
            </span>
          )}
          {(startId || endId) && (
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] uppercase text-slate-500 hover:bg-slate-50"
            >
              очистить
            </button>
          )}
        </div>
      </div>

      {/* Quick presets: deadline = base + offset (P7.2). Base = start (если есть)
          либо текущая неделя. */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-slate-400">Quick</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => applyPreset(p.days)}
            className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
            title={`Дедлайн = ${start ? "начало" : "текущая неделя"} + ${p.days} дн.`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        {[1, 2, 3, 4].map((q) => {
          const weeks = (shape.weeksByQuarter.get(q) ?? []).slice().sort((a, b) => (a.week_n ?? 0) - (b.week_n ?? 0));
          return (
            <div key={q} className="flex items-center gap-1.5">
              <span className="w-5 shrink-0 text-[10px] font-semibold text-slate-400">Q{q}</span>
              <div className="grid flex-1 gap-1 grid-cols-[repeat(13,minmax(0,1fr))]">
                {weeks.length === 0 ? (
                  <div className="col-span-full rounded-md bg-slate-50 px-2 py-1 text-[10px] text-slate-400">
                    нет недель — год не засеян
                  </div>
                ) : (
                  weeks.map((w) => {
                    const inRange = isInRange(w);
                    const isStart = w.id === startId;
                    const isEnd = w.id === endId;
                    const isEdge = isStart || isEnd;
                    const isNow = nowPeriod?.id === w.id;
                    const wnLabel = w.week_n != null ? `W${w.week_n}` : "—";
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => handleClick(w)}
                        title={`${wnLabel} · ${w.start_date.slice(5)}–${w.end_date.slice(5)}`}
                        className={`h-6 rounded-md text-[10px] font-medium tabular-nums transition-colors ${
                          isEdge
                            ? "bg-blue-600 text-white"
                            : inRange
                              ? "bg-blue-100 text-blue-800"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        } ${isNow ? "ring-2 ring-amber-400" : ""}`}
                      >
                        {w.week_n ?? "—"}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
