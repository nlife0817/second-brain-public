"use client";

// Неделя и день на телефоне: часовая сетка с полосой «весь день» сверху.
//
// Раскладка — те же чистые `layoutBars`/`layoutDay`, что у десктопного полотна:
// вторая реализация пересечений разошлась бы с первой, и одна и та же неделя
// выглядела бы на телефоне иначе.
//
// Что здесь своё: колонка недели шириной в палец (подписи времени в плашке нет —
// от неё остаётся многоточие вместо названия), прокрутка к текущему часу вместо
// полуночи и полное отсутствие жестов правки — тап открывает карточку.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MINUTES_IN_DAY,
  SNAP_MINUTES,
  layoutBars,
  layoutDay,
  type CalendarItem,
  type DayRange,
} from "@/lib/core/calendar";
import { WEEKDAYS_SHORT, daysOf, dayOfMonth, isWeekend, weekday } from "@/lib/core/days";
import { cn } from "@/lib/utils";
import { CalendarChip } from "./parts";

/** Высота часа. Меньше — в блок не влезает даже одна строка названия. */
const HOUR_H = 52;
/** Ширина колонки с часами. */
const GUTTER_W = 40;
/** Высота плашки в полосе «весь день» и зазор между дорожками. */
const CHIP_H = 20;
const LANE_H = CHIP_H + 2;
/** Сколько дорожек показывает полоса «весь день» до собственной прокрутки. */
const ALLDAY_LANES = 2;
/** Куда прокручена сетка, если сегодняшнего дня в окне нет. */
const DEFAULT_SCROLL_HOUR = 7;
/** Как часто переставляется линия текущего времени. */
const NOW_TICK_MS = 60_000;

export function MobileTimeView({
  range,
  items,
  today,
  onOpen,
  onOpenDay,
}: {
  range: DayRange;
  items: CalendarItem[];
  today: string;
  onOpen: (item: CalendarItem) => void;
  /** Тап по шапке дня в неделе — переход на этот день. */
  onOpenDay: (day: string) => void;
}) {
  const days = useMemo(() => daysOf(range), [range]);
  const dense = days.length > 1;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);

  // Линия текущего времени появляется только после гидрации: на сервере
  // «сейчас» — это время контейнера, и разметка разошлась бы с браузерной.
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const id = window.setInterval(tick, NOW_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Открываем сетку на текущем часе, а не на полуночи: иначе первое, что делает
  // человек на каждом экране, — крутит её вниз.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now = new Date();
    const hour =
      today >= range.from && today <= range.to ? Math.max(0, now.getHours() - 1) : DEFAULT_SCROLL_HOUR;
    el.scrollTop = hour * HOUR_H;
  }, [range.from, range.to, today]);

  const allDayBars = useMemo(() => layoutBars(items, days), [items, days]);
  const allDayLanes = allDayBars.reduce((n, b) => Math.max(n, b.lane + 1), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Шапка дней: в масштабе «День» дата уже стоит в шапке экрана. */}
      {dense && (
        <div className="flex shrink-0 border-b border-border">
          <div className="shrink-0" style={{ width: GUTTER_W }} />
          {days.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => onOpenDay(day)}
              className="flex flex-1 flex-col items-center gap-0.5 py-1 active:bg-muted"
            >
              <span
                className={cn(
                  "text-[9px] uppercase",
                  isWeekend(day) ? "text-muted-foreground/70" : "text-muted-foreground",
                )}
              >
                {WEEKDAYS_SHORT[weekday(day)]}
              </span>
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-[13px] tabular-nums",
                  day === today ? "bg-primary font-semibold text-primary-foreground" : "font-medium",
                )}
              >
                {dayOfMonth(day)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Полоса «весь день»: многодневное и всё, у чего времени нет. */}
      {allDayLanes > 0 && (
        <div className="flex shrink-0 border-b border-border">
          <div
            className="shrink-0 py-1 pr-1.5 text-right text-[9px] uppercase leading-none text-muted-foreground"
            style={{ width: GUTTER_W }}
          >
            весь
            <br />
            день
          </div>
          <div
            className="min-w-0 flex-1 overflow-y-auto overscroll-contain py-0.5"
            style={{ maxHeight: ALLDAY_LANES * LANE_H + 4 }}
          >
            <div
              className="grid"
              style={{
                gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
                gridAutoRows: LANE_H,
              }}
            >
              {allDayBars.map((b) => (
                <div
                  key={b.item.key}
                  className="min-w-0 px-px"
                  style={{ gridColumn: `${b.offset + 1} / span ${b.span}`, gridRow: b.lane + 1 }}
                >
                  <CalendarChip
                    item={b.item}
                    variant="bar"
                    dense={dense}
                    style={{ height: CHIP_H }}
                    className={cn(b.clippedStart && "rounded-l-none", b.clippedEnd && "rounded-r-none")}
                    onOpen={onOpen}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Часовая сетка */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex" style={{ height: 24 * HOUR_H }}>
          <div className="relative shrink-0" style={{ width: GUTTER_W }}>
            {Array.from({ length: 24 }, (_, h) => (
              <span
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: h * HOUR_H }}
              >
                {h === 0 ? "" : `${String(h).padStart(2, "0")}`}
              </span>
            ))}
          </div>

          <div className="relative min-w-0 flex-1">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="pointer-events-none absolute inset-x-0 border-t border-border/60"
                style={{ top: h * HOUR_H }}
              />
            ))}

            <div
              className="absolute inset-0 grid"
              style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
            >
              {days.map((day) => (
                <DayColumn
                  key={day}
                  day={day}
                  items={items}
                  today={today}
                  dense={dense}
                  nowMinutes={nowMinutes}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  items,
  today,
  dense,
  nowMinutes,
  onOpen,
}: {
  day: string;
  items: CalendarItem[];
  today: string;
  dense: boolean;
  nowMinutes: number | null;
  onOpen: (item: CalendarItem) => void;
}) {
  const blocks = useMemo(() => layoutDay(items, day), [items, day]);

  return (
    <div
      className={cn(
        "relative min-w-0 border-r border-border/60 last:border-r-0",
        isWeekend(day) && "bg-muted/20",
      )}
    >
      {blocks.map(({ item, column, columns }) => (
        <div
          key={item.key}
          className="absolute px-px"
          style={{
            top: (item.startMinutes / 60) * HOUR_H,
            // Минимальная высота: блок на пять минут иначе превращается в
            // полоску, по которой не попасть пальцем.
            height: Math.max(
              (SNAP_MINUTES / 60) * HOUR_H,
              ((Math.min(item.endMinutes, MINUTES_IN_DAY) - item.startMinutes) / 60) * HOUR_H,
            ),
            left: `${(column / columns) * 100}%`,
            width: `${(1 / columns) * 100}%`,
          }}
        >
          <CalendarChip
            item={item}
            variant="block"
            dense={dense}
            style={{ height: "100%" }}
            className={cn(
              // Пунктир у выведенного края: длительность нарисована, а не задана,
              // и обещать её сплошной границей нельзя.
              item.inferredEnd && "border-b border-dashed border-current/40",
              item.inferredStart && "border-t border-dashed border-current/40",
            )}
            onOpen={onOpen}
          />
        </div>
      ))}

      {day === today && nowMinutes != null && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
          style={{ top: (nowMinutes / 60) * HOUR_H }}
        >
          <span className="absolute -left-1 -top-1 size-2 rounded-full bg-red-500" />
        </div>
      )}
    </div>
  );
}
