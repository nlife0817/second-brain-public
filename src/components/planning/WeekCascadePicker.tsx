"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  isoWeek,
  weekKey,
  parseWeekKey,
  weekStartDate,
  weeksInMonth,
  weeksInYear,
  monthsOfQuarter,
  quarterOfWeek,
  monthOfWeek,
  formatDayShort,
} from "@/lib/iso-week";

const MONTH_LABELS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

interface Props {
  value: string; // weekKey "YYYY-Www"
  onChange: (key: string) => void;
  /** Сколько лет вокруг текущего показывать в столбце «Год». */
  yearsAround?: number;
  className?: string;
}

export function WeekCascadePicker({ value, onChange, yearsAround = 5, className }: Props) {
  const [open, setOpen] = useState(false);

  const parsed = parseWeekKey(value) ?? isoWeek(new Date());
  const selectedYear = parsed.year;
  const selectedWeek = parsed.week;
  const selectedQuarter = quarterOfWeek(selectedYear, selectedWeek);
  const selectedMonth = monthOfWeek(selectedYear, selectedWeek);

  // Внутреннее состояние навигации внутри пикера (без подтверждения).
  const [navYear, setNavYear] = useState(selectedYear);
  const [navQuarter, setNavQuarter] = useState<1 | 2 | 3 | 4>(selectedQuarter);
  const [navMonth, setNavMonth] = useState(selectedMonth);

  const todayInfo = useMemo(() => isoWeek(new Date()), []);
  const todayKey = weekKey(todayInfo.year, todayInfo.week);

  const years = useMemo(() => {
    const cy = todayInfo.year;
    return Array.from({ length: yearsAround * 2 + 1 }, (_, i) => cy - yearsAround + i);
  }, [todayInfo.year, yearsAround]);

  const monthsForQ = useMemo(() => monthsOfQuarter(navQuarter), [navQuarter]);
  const weeksList = useMemo(() => weeksInMonth(navYear, navMonth), [navYear, navMonth]);

  // Label для триггера
  const triggerInfo = useMemo(() => {
    const start = weekStartDate(selectedYear, selectedWeek);
    const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
    return { start, end };
  }, [selectedYear, selectedWeek]);

  const pickWeek = (year: number, week: number) => {
    onChange(weekKey(year, week));
    setOpen(false);
  };

  const onYearClick = (y: number) => {
    setNavYear(y);
    // если уходим из текущего года — сбрасываем квартал/месяц на 1/1
    if (y !== selectedYear) {
      setNavQuarter(1);
      setNavMonth(1);
    }
  };

  const onQuarterClick = (q: 1 | 2 | 3 | 4) => {
    setNavQuarter(q);
    // месяц = первый месяц квартала
    setNavMonth(monthsOfQuarter(q)[0]);
  };

  const onMonthClick = (m: number) => {
    setNavMonth(m);
    // авто-синхронизация квартала
    const q = (Math.floor((m - 1) / 3) + 1) as 1 | 2 | 3 | 4;
    if (q !== navQuarter) setNavQuarter(q);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(p) => (
          <button
            {...p}
            className={`inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm font-medium text-slate-800 hover:bg-slate-50 ${className ?? ""}`}
          >
            <span>
              {selectedYear}-W{String(selectedWeek).padStart(2, "0")} ·{" "}
              <span className="text-slate-500">
                {formatDayShort(triggerInfo.start)} – {formatDayShort(triggerInfo.end)}
              </span>
            </span>
            <ChevronDown className="size-3.5 text-slate-500" />
          </button>
        )}
      />
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[560px] p-0"
      >
        <div className="grid grid-cols-4 gap-0 divide-x divide-slate-100">
          {/* Years */}
          <Column title="Год">
            {years.map((y) => (
              <Cell
                key={y}
                active={y === navYear}
                selected={y === selectedYear}
                onClick={() => onYearClick(y)}
              >
                {y}
              </Cell>
            ))}
          </Column>

          {/* Quarters */}
          <Column title="Квартал">
            {([1, 2, 3, 4] as const).map((q) => (
              <Cell
                key={q}
                active={q === navQuarter}
                selected={navYear === selectedYear && q === selectedQuarter}
                onClick={() => onQuarterClick(q)}
              >
                Q{q}
              </Cell>
            ))}
          </Column>

          {/* Months */}
          <Column title="Месяц">
            {monthsForQ.map((m) => (
              <Cell
                key={m}
                active={m === navMonth}
                selected={navYear === selectedYear && m === selectedMonth}
                onClick={() => onMonthClick(m)}
              >
                {MONTH_LABELS[m - 1]}
              </Cell>
            ))}
          </Column>

          {/* Weeks */}
          <Column title="Неделя">
            {weeksList.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-slate-400">—</p>
            )}
            {weeksList.map((w) => {
              const k = weekKey(w.year, w.week);
              const isSelected = w.year === selectedYear && w.week === selectedWeek;
              const isToday = k === todayKey;
              return (
                <Cell
                  key={k}
                  active={false}
                  selected={isSelected}
                  highlight={isToday}
                  onClick={() => pickWeek(w.year, w.week)}
                  title={`${formatDayShort(w.start)} – ${formatDayShort(w.end)}`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span>W{String(w.week).padStart(2, "0")}</span>
                    <span className="text-[10px] text-slate-400">
                      {formatDayShort(w.start)}
                      {w.crossMonth && <span className="ml-0.5 text-amber-500" title="неделя из двух месяцев">•</span>}
                    </span>
                  </span>
                </Cell>
              );
            })}
            {/* fallback: для крайних месяцев года может быть W53 в декабре */}
            {navMonth === 12 && weeksInYear(navYear) === 53 && !weeksList.some((w) => w.week === 53) && (
              <Cell active={false} selected={false} onClick={() => pickWeek(navYear, 53)}>
                W53
              </Cell>
            )}
          </Column>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
          <button
            type="button"
            onClick={() => pickWeek(todayInfo.year, todayInfo.week)}
            className="rounded px-1.5 py-0.5 font-medium text-blue-600 hover:bg-blue-50"
          >
            Сегодня · {todayKey}
          </button>
          <span className="tabular-nums">
            Выбрано: {selectedYear}-W{String(selectedWeek).padStart(2, "0")}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex max-h-[320px] flex-col">
      <div className="sticky top-0 border-b border-slate-100 bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto py-1">{children}</div>
    </div>
  );
}

function Cell({
  active, selected, highlight, onClick, children, title,
}: {
  active: boolean;
  selected: boolean;
  highlight?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        "mx-1 my-px rounded px-2 py-1 text-left text-xs transition-colors",
        selected
          ? "bg-blue-600 text-white"
          : active
            ? "bg-slate-200 text-slate-800"
            : highlight
              ? "bg-amber-50 text-amber-800 hover:bg-amber-100"
              : "text-slate-700 hover:bg-slate-100",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
