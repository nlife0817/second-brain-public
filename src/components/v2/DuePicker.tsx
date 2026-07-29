"use client";

// Выбор срока: календарь и время в одном поповере. Правки копятся в черновике
// и уходят наружу единым патчем при закрытии — выбор даты не закрывает окно и
// не дёргает сервер на каждый клик, чтобы дату и время можно было выставить за
// один заход.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, RotateCcw, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Время, которое подставляется по кнопке «Добавить время». Само по себе, вместе
 * с выбором дня, оно больше не появляется: срок «30 июля» и срок «30 июля 10:00»
 * — разные обещания, и второе нельзя брать за человека.
 */
export const DEFAULT_DUE_TIME = "10:00";

const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const YEARS_PER_PAGE = 12;
/** Сколько лет прошлого показать до текущего — остальное уходит в будущее. */
const YEARS_BEHIND = 5;
const MINUTE_STEP = 5;
/** Накопленная дельта колеса, после которой делаем шаг. Тачпад шлёт мелкие. */
const WHEEL_THRESHOLD = 24;

type Mode = "days" | "months" | "years";
type ViewMonth = { y: number; m: number };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

function isoToday(): string {
  const t = new Date();
  return toIso(t.getFullYear(), t.getMonth(), t.getDate());
}

/** ISO-день через `days` суток от сегодняшнего. Перевод месяца делает сам Date. */
function isoInDays(days: number): string {
  const t = new Date();
  const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + days);
  return toIso(d.getFullYear(), d.getMonth(), d.getDate());
}

const DAY_PRESETS: Array<{ label: string; days: number }> = [
  { label: "Сегодня", days: 0 },
  { label: "Завтра", days: 1 },
  { label: "Через неделю", days: 7 },
];

/** Месяц, который показываем при открытии: месяц выбранной даты или текущий. */
function monthOf(iso: string | null): ViewMonth {
  if (iso) {
    const [y, m] = iso.split("-").map(Number);
    if (y && m) return { y, m: m - 1 };
  }
  const t = new Date();
  return { y: t.getFullYear(), m: t.getMonth() };
}

function splitTime(time: string | null): { h: number; m: number } | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return { h, m };
}

/** Незакоммиченный ручной ввод: `null` — поле не трогали. */
type RawTime = { h: string | null; m: string | null };

const NO_RAW: RawTime = { h: null, m: null };

function clamp(n: number, max: number): number {
  return Math.min(max, Math.max(0, n));
}

/**
 * Время с учётом набранного, но ещё не подтверждённого руками. Поповер
 * закрывается по нажатию мыши снаружи — раньше, чем поле успевает потерять
 * фокус, поэтому набранное нельзя держать внутри самого поля.
 */
function resolveTime(time: string | null, raw: RawTime): string | null {
  const typedH = raw.h != null && raw.h.trim() !== "";
  const typedM = raw.m != null && raw.m.trim() !== "";
  if (!typedH && !typedM) return time;
  const base = splitTime(time) ?? splitTime(DEFAULT_DUE_TIME)!;
  return `${pad2(typedH ? clamp(Number(raw.h), 23) : base.h)}:${pad2(typedM ? clamp(Number(raw.m), 59) : base.m)}`;
}

/**
 * Шаг колеса по времени. Первый оборот при пустом времени просто включает
 * значение по умолчанию, дальше крутится от него. Минуты приводятся к сетке
 * в 5 минут, чтобы после ручного ввода «17» колесо давало 20, а не 22.
 */
function stepTime(prev: string | null, dir: number, unit: "h" | "m"): string {
  const parts = splitTime(prev);
  if (!parts) return DEFAULT_DUE_TIME;
  if (unit === "h") return `${pad2((parts.h + dir + 24) % 24)}:${pad2(parts.m)}`;
  const raw =
    dir > 0
      ? Math.floor(parts.m / MINUTE_STEP) * MINUTE_STEP + MINUTE_STEP
      : Math.ceil(parts.m / MINUTE_STEP) * MINUTE_STEP - MINUTE_STEP;
  return `${pad2(parts.h)}:${pad2((raw + 60) % 60)}`;
}

/**
 * Нативный обработчик колеса: React вешает `wheel` пассивно, а нам нужен
 * `preventDefault()` — иначе прокрутка над полем уедет в таблицу под поповером.
 */
function useWheelStep(onStep: (dir: 1 | -1) => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const handler = useRef(onStep);

  useEffect(() => {
    handler.current = onStep;
  }, [onStep]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let acc = 0;
    function wheel(e: WheelEvent) {
      e.preventDefault();
      acc += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      if (Math.abs(acc) < WHEEL_THRESHOLD) return;
      handler.current(acc < 0 ? 1 : -1);
      acc = 0;
    }
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [enabled]);

  return ref;
}

const NAV_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
const HEAD_BUTTON =
  "rounded-md px-1.5 py-0.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Одно поле времени: ручной ввод, колесо мыши, стрелки клавиатуры и шевроны.
 * Набранное живёт в родителе — см. `resolveTime`.
 */
function TimeSegment({
  display,
  placeholder,
  disabled,
  label,
  onType,
  onCommit,
  onStep,
}: {
  display: string;
  placeholder: string;
  disabled: boolean;
  label: string;
  onType: (raw: string) => void;
  onCommit: () => void;
  onStep: (dir: 1 | -1) => void;
}) {
  const wheelRef = useWheelStep(onStep, !disabled);

  return (
    <div
      ref={wheelRef}
      className={cn(
        "flex h-8 w-[3.75rem] items-center rounded-md border border-input bg-transparent transition-colors focus-within:border-ring",
        disabled && "opacity-50",
      )}
    >
      <input
        value={display}
        disabled={disabled}
        inputMode="numeric"
        aria-label={label}
        placeholder={placeholder}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onType(e.target.value.replace(/\D/g, "").slice(0, 2))}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onStep(1);
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            onStep(-1);
          }
        }}
        className="h-full min-w-0 flex-1 bg-transparent pl-2 text-sm tabular-nums outline-none placeholder:text-muted-foreground/60"
      />
      <span className="flex shrink-0 flex-col pr-0.5">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={`${label}: больше`}
          onClick={() => onStep(1)}
          className="flex h-3.5 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronUp className="size-3" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={`${label}: меньше`}
          onClick={() => onStep(-1)}
          className="flex h-3.5 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronDown className="size-3" />
        </button>
      </span>
    </div>
  );
}

/**
 * Сетка дней с быстрыми датами и переключением на месяцы и годы. Состояние
 * навигации своё и заводится от выбранной даты, поэтому панель монтируется
 * только на время открытого поповера: закрытый Base UI детей не размонтирует, и
 * следующее открытие показало бы месяц, до которого долистали в прошлый раз.
 */
function CalendarPanel({ value, onPick }: { value: string | null; onPick: (iso: string) => void }) {
  const [view, setView] = useState<ViewMonth>(() => monthOf(value));
  const [mode, setMode] = useState<Mode>("days");
  const [yearBase, setYearBase] = useState(() => monthOf(value).y - YEARS_BEHIND);

  const today = isoToday();

  const days = useMemo(() => {
    const shift = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // неделя с понедельника
    // Всегда шесть недель — иначе поповер прыгает по высоте при смене месяца.
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(view.y, view.m, 1 - shift + i);
      return {
        iso: toIso(d.getFullYear(), d.getMonth(), d.getDate()),
        day: d.getDate(),
        outside: d.getMonth() !== view.m,
      };
    });
  }, [view]);

  function pickDay(iso: string) {
    onPick(iso);
    setView(monthOf(iso));
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  return (
        <div className="flex flex-col gap-1.5 p-2">
          {/* Шапка: стрелки листают то, что сейчас выбирается. */}
          <div className="flex items-center justify-between gap-1">
            <button
              type="button"
              aria-label="Назад"
              className={NAV_BUTTON}
              onClick={() => {
                if (mode === "days") shiftMonth(-1);
                else if (mode === "months") setView((v) => ({ ...v, y: v.y - 1 }));
                else setYearBase((b) => b - YEARS_PER_PAGE);
              }}
            >
              <ChevronLeft className="size-4" />
            </button>

            {mode === "years" ? (
              <span className="text-sm font-medium tabular-nums">
                {yearBase} — {yearBase + YEARS_PER_PAGE - 1}
              </span>
            ) : (
              <span className="flex items-center gap-0.5">
                {mode === "days" && (
                  <button type="button" className={HEAD_BUTTON} onClick={() => setMode("months")}>
                    {MONTHS[view.m]}
                  </button>
                )}
                <button
                  type="button"
                  className={cn(HEAD_BUTTON, "tabular-nums")}
                  onClick={() => {
                    setYearBase(view.y - YEARS_BEHIND);
                    setMode("years");
                  }}
                >
                  {view.y}
                </button>
              </span>
            )}

            <button
              type="button"
              aria-label="Вперёд"
              className={NAV_BUTTON}
              onClick={() => {
                if (mode === "days") shiftMonth(1);
                else if (mode === "months") setView((v) => ({ ...v, y: v.y + 1 }));
                else setYearBase((b) => b + YEARS_PER_PAGE);
              }}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {mode === "days" && (
            <>
              {/* Быстрые дни: за ними приходят чаще, чем за конкретной датой в
                  календаре, поэтому они стоят до сетки, а не под ней. */}
              <div className="flex gap-1">
                {DAY_PRESETS.map((p) => {
                  const iso = isoInDays(p.days);
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => pickDay(iso)}
                      className={cn(
                        "flex h-7 min-w-0 flex-1 items-center justify-center rounded-md border px-1 text-[11px] transition-colors",
                        iso === value
                          ? "border-primary bg-primary/10 font-medium text-primary"
                          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <span className="truncate">{p.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-7 gap-0.5">
                {WEEKDAYS.map((w) => (
                  <span
                    key={w}
                    className="flex h-6 items-center justify-center text-[11px] text-muted-foreground"
                  >
                    {w}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {days.map((d) => {
                  const selected = d.iso === value;
                  return (
                    <button
                      key={d.iso}
                      type="button"
                      onClick={() => pickDay(d.iso)}
                      className={cn(
                        "flex h-8 items-center justify-center rounded-md text-xs tabular-nums transition-colors",
                        d.outside ? "text-muted-foreground/40" : "text-foreground",
                        !selected && "hover:bg-muted",
                        d.iso === today && !selected && "ring-1 ring-inset ring-ring/60",
                        selected && "bg-primary font-medium text-primary-foreground",
                      )}
                    >
                      {d.day}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {mode === "months" && (
            <div className="grid grid-cols-3 gap-1 py-1">
              {MONTHS.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    setView((v) => ({ ...v, m: i }));
                    setMode("days");
                  }}
                  className={cn(
                    "flex h-11 items-center justify-center rounded-md px-1 text-xs transition-colors hover:bg-muted",
                    view.m === i && "bg-primary font-medium text-primary-foreground hover:bg-primary",
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          {mode === "years" && (
            <div className="grid grid-cols-4 gap-1 py-1">
              {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearBase + i).map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => {
                    setView((v) => ({ ...v, y }));
                    setMode("days");
                  }}
                  className={cn(
                    "flex h-11 items-center justify-center rounded-md text-xs tabular-nums transition-colors hover:bg-muted",
                    view.y === y && "bg-primary font-medium text-primary-foreground hover:bg-primary",
                  )}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
  );
}

export function DuePicker({
  date,
  time,
  align = "start",
  triggerClassName,
  onCommit,
  children,
}: {
  date: string | null;
  /** Может прийти как `HH:MM:SS` из базы — обрежем сами. */
  time: string | null;
  align?: "start" | "center" | "end";
  triggerClassName?: string;
  /** Дёргается один раз при закрытии и только если что-то изменилось. */
  onCommit: (next: { due_date: string | null; due_time: string | null }) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<string | null>(null);
  const [draftTime, setDraftTime] = useState<string | null>(null);
  const [raw, setRaw] = useState<RawTime>(NO_RAW);

  const savedTime = time ? time.slice(0, 5) : null;

  /** Колесо и стрелки всегда крутят уже набранное, а не значение до правки. */
  function step(unit: "h" | "m", dir: 1 | -1) {
    setDraftTime((p) => stepTime(resolveTime(p, raw), dir, unit));
    setRaw(NO_RAW);
  }

  /** Уход фокуса из поля: набранное становится значением черновика. */
  function commitRaw(unit: "h" | "m") {
    const only: RawTime = unit === "h" ? { h: raw.h, m: null } : { h: null, m: raw.m };
    setDraftTime((p) => resolveTime(p, only));
    setRaw((r) => ({ ...r, [unit]: null }));
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraftDate(date);
      setDraftTime(savedTime);
      setRaw(NO_RAW);
    } else {
      const nextDate = draftDate;
      const nextTime = nextDate ? resolveTime(draftTime, raw) : null;
      if (nextDate !== date || nextTime !== savedTime) {
        onCommit({ due_date: nextDate, due_time: nextTime });
      }
    }
    setOpen(next);
  }

  function pickDay(iso: string) {
    setDraftDate(iso);
  }

  const parts = splitTime(draftTime);
  const timeDisabled = !draftDate;
  const hDisplay = raw.h ?? (parts ? pad2(parts.h) : "");
  const mDisplay = raw.m ?? (parts ? pad2(parts.m) : "");
  /** Время ещё не заведено — вместо полей показываем одну кнопку. */
  const timeUnset = !draftTime && !raw.h && !raw.m;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={<button type="button" className={triggerClassName} />}>
        {children}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 gap-0 p-0">
        {open && <CalendarPanel value={draftDate} onPick={pickDay} />}

        <div className="flex flex-col gap-2 border-t border-border p-2">
          {/* Пока времени нет — вместо пустых полей одна кнопка: так видно, что
              срок стоит на день целиком, а не на 00:00. */}
          {timeUnset ? (
            <button
              type="button"
              disabled={timeDisabled}
              onClick={() => setDraftTime(DEFAULT_DUE_TIME)}
              className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Clock className="size-3.5 shrink-0" />
              {timeDisabled ? "Сначала выберите день" : "Добавить время"}
            </button>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Время</span>
              <span className="flex items-center gap-1">
                <TimeSegment
                  display={hDisplay}
                  placeholder="10"
                  disabled={timeDisabled}
                  label="Часы"
                  onType={(v) => setRaw((r) => ({ ...r, h: v }))}
                  onCommit={() => commitRaw("h")}
                  onStep={(dir) => step("h", dir)}
                />
                <span className={cn("text-sm text-muted-foreground", timeDisabled && "opacity-50")}>:</span>
                <TimeSegment
                  display={mDisplay}
                  placeholder="00"
                  disabled={timeDisabled}
                  label="Минуты"
                  onType={(v) => setRaw((r) => ({ ...r, m: v }))}
                  onCommit={() => commitRaw("m")}
                  onStep={(dir) => step("m", dir)}
                />
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              disabled={timeUnset}
              onClick={() => {
                setDraftTime(null);
                setRaw(NO_RAW);
              }}
              className="flex items-center justify-center gap-1 rounded-md border border-border px-1 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <X className="size-3.5 shrink-0" /> Убрать время
            </button>
            <button
              type="button"
              disabled={!draftDate}
              onClick={() => {
                setDraftDate(null);
                setDraftTime(null);
                setRaw(NO_RAW);
              }}
              className="flex items-center justify-center gap-1 rounded-md border border-border px-1 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <RotateCcw className="size-3.5 shrink-0" /> Сбросить дату
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Дата без времени — начало работ. Отдельный компонент, а не флаг у `DuePicker`:
 * там черновик сложный (незакоммиченный ввод времени, `resolveTime`), и половина
 * его состояния при `dateOnly` была бы мёртвой.
 *
 * Выбор дня закрывает поповер сразу: копить тут нечего, а лишний клик «готово»
 * на одном поле — раздражение.
 */
export function DatePicker({
  date,
  align = "start",
  triggerClassName,
  onCommit,
  children,
}: {
  date: string | null;
  align?: "start" | "center" | "end";
  triggerClassName?: string;
  onCommit: (next: string | null) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<button type="button" className={triggerClassName} />}>
        {children}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 gap-0 p-0">
        {open && (
          <CalendarPanel
            value={date}
            onPick={(iso) => {
              if (iso !== date) onCommit(iso);
              setOpen(false);
            }}
          />
        )}
        <div className="border-t border-border p-2">
          <button
            type="button"
            disabled={!date}
            onClick={() => {
              onCommit(null);
              setOpen(false);
            }}
            className="flex w-full items-center justify-center gap-1 rounded-md border border-border px-1 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <RotateCcw className="size-3.5 shrink-0" /> Сбросить дату
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
