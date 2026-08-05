"use client";

// Месяц на телефоне: компактная сетка с точками занятости и список дел
// выбранного дня под ней.
//
// Плашки с названиями, как на десктопе, в колонку шириной 53 px не помещаются —
// от названия остаются пять букв, и сетка перестаёт отвечать даже на вопрос
// «когда я занят». Точка отвечает на него сразу, а что именно за дела — говорит
// список, до которого один тап.

import { useMemo } from "react";
import { rangeTitle, weeksOf, type CalendarItem, type DayRange } from "@/lib/core/calendar";
import { WEEKDAYS_SHORT, addDays, dayOfMonth, daysOf, isWeekend, monthIndex } from "@/lib/core/days";
import { cn } from "@/lib/utils";
import { AgendaRow, itemColor } from "./parts";

/** Сколько точек рисует клетка, прежде чем перейти на «+N». */
const MAX_DOTS = 4;

/** Дела дня: сначала «весь день» и многодневное, потом по времени начала. */
function compareItems(a: CalendarItem, b: CalendarItem): number {
  if (a.bar !== b.bar) return a.bar ? -1 : 1;
  if (!a.bar && a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
  return a.title.localeCompare(b.title, "ru");
}

export function MobileMonthView({
  range,
  anchor,
  items,
  today,
  selected,
  onSelectDay,
  onOpen,
}: {
  range: DayRange;
  /** Опорный день: по нему клетки соседних месяцев рисуются приглушённо. */
  anchor: string;
  items: CalendarItem[];
  today: string;
  selected: string;
  onSelectDay: (day: string) => void;
  onOpen: (item: CalendarItem) => void;
}) {
  const weeks = useMemo(() => weeksOf(range), [range]);

  // Раскладка по дням считается один раз на окно: и точки в клетках, и список
  // выбранного дня берутся отсюда, а не пересчитываются по 42 клеткам.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const day of daysOf(range)) map.set(day, []);
    for (const item of items) {
      let day = item.startDay < range.from ? range.from : item.startDay;
      while (day <= item.endDay && day <= range.to) {
        map.get(day)?.push(item);
        day = addDays(day, 1);
      }
    }
    for (const list of map.values()) list.sort(compareItems);
    return map;
  }, [items, range]);

  const month = monthIndex(anchor);
  const dayItems = byDay.get(selected) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {WEEKDAYS_SHORT.map((label, i) => (
          <span
            key={label}
            className={cn(
              "py-1 text-center text-[10px] uppercase",
              i >= 5 ? "text-muted-foreground/70" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
        ))}
      </div>

      <div className="shrink-0">
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7">
            {week.map((day) => {
              const list = byDay.get(day) ?? [];
              const dots = list.slice(0, MAX_DOTS);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-pressed={day === selected}
                  // Голосом клетка читается одним числом, и без даты целиком
                  // непонятно даже, какой это месяц.
                  aria-label={`${rangeTitle(day, "day")}${list.length > 0 ? `, дел: ${list.length}` : ""}`}
                  className={cn(
                    "flex h-12 flex-col items-center justify-start gap-1 border-b border-r border-border/50 pt-1 last:border-r-0",
                    isWeekend(day) && "bg-muted/20",
                    day === selected && "bg-primary/10",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-[13px] tabular-nums",
                      monthIndex(day) !== month && "text-muted-foreground/50",
                      day === today
                        ? "bg-primary font-semibold text-primary-foreground"
                        : day === selected && "font-semibold",
                    )}
                  >
                    {dayOfMonth(day)}
                  </span>
                  <span className="flex h-2 items-center gap-[3px]">
                    {dots.map((item) => (
                      <span
                        key={item.key}
                        className={cn("size-1.5 rounded-full", item.done && "opacity-40")}
                        style={{ backgroundColor: itemColor(item) }}
                      />
                    ))}
                    {list.length > MAX_DOTS && (
                      <span className="text-[8px] leading-none text-muted-foreground">
                        +{list.length - MAX_DOTS}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        <h2 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground first-letter:uppercase">
          {rangeTitle(selected, "day")}
          {dayItems.length > 0 && ` · ${dayItems.length}`}
        </h2>
        {dayItems.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">На этот день ничего нет</p>
        ) : (
          <div className="flex flex-col divide-y divide-border/50">
            {dayItems.map((item) => (
              <AgendaRow key={item.key} item={item} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
