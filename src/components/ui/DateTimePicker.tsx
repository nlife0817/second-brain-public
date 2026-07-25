"use client";

import { useState, useCallback, useEffect } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarIcon, Clock, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export type DateTimeValue = {
  date: string | null; // 'YYYY-MM-DD'
  time: string | null; // 'HH:MM' or null
};

type Props = {
  value: DateTimeValue;
  onChange: (next: DateTimeValue) => void;
  placeholder?: string;
  size?: "xs" | "sm" | "md";
  className?: string;
  disabled?: boolean;
  /** If true, trigger only shows an icon and selected value on the right (compact). */
  compact?: boolean;
  align?: "start" | "center" | "end";
  /** If true, hides the year part when the selected date is in the current year. */
  hideCurrentYear?: boolean;
  /** If false, overdue dates render neutrally. Useful for completed/archived tasks. */
  highlightOverdue?: boolean;
};

function parseDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  // 'YYYY-MM-DD' → local Date at midnight
  const parts = s.split("-");
  if (parts.length !== 3) return undefined;
  const [y, m, d] = parts.map((p) => parseInt(p, 10));
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Без срока",
  size = "sm",
  className,
  disabled,
  compact = false,
  align = "start",
  hideCurrentYear = false,
  highlightOverdue = true,
}: Props) {
  const [open, setOpen] = useState(false);

  // Buffered editing: changes made inside the popover are local until the user
  // hits "Применить" (or "Убрать срок"). Outside-click / Escape discards the
  // buffer. This avoids per-keystroke store updates and the row-jumping that
  // comes with them when the list is sorted by due_date.
  const [buffer, setBuffer] = useState<DateTimeValue>(value);

  // Re-sync the buffer whenever the popover opens (or props change while open
  // due to an external update).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setBuffer(value);
  }, [open, value]);

  const committedDate = parseDate(value.date);
  const bufferedDate = parseDate(buffer.date);

  const isOverdue = highlightOverdue && committedDate && (() => {
    const now = new Date();
    if (value.time && /^\d{2}:\d{2}$/.test(value.time)) {
      const [h, m] = value.time.split(":").map((p) => parseInt(p, 10));
      const deadline = new Date(committedDate);
      deadline.setHours(h, m, 0, 0);
      return deadline < now;
    }
    const endOfDay = new Date(committedDate);
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay < now;
  })();

  const heightCls = size === "xs" ? "h-6 text-xs" : size === "sm" ? "h-7 text-xs" : "h-8 text-sm";
  const iconSize = size === "xs" ? "size-3" : "size-3.5";

  const sameYear = committedDate && committedDate.getFullYear() === new Date().getFullYear();
  const dateFormat = hideCurrentYear && sameYear ? "d MMM" : "d MMM yyyy";
  const label = committedDate
    ? value.time && /^\d{2}:\d{2}$/.test(value.time)
      ? `${format(committedDate, "d MMM", { locale: ru })} · ${value.time}`
      : format(committedDate, dateFormat, { locale: ru })
    : placeholder;

  const handleDate = useCallback((d: Date | undefined) => {
    setBuffer((prev) => ({
      date: d ? toIsoDate(d) : null,
      time: d ? prev.time : null,
    }));
  }, []);

  const handleTime = useCallback((t: string) => {
    const normalized = /^\d{2}:\d{2}$/.test(t) ? t : null;
    setBuffer((prev) => ({ date: prev.date, time: normalized }));
  }, []);

  const handleApply = useCallback(() => {
    const sameDate = buffer.date === value.date;
    const sameTime = (buffer.time ?? null) === (value.time ?? null);
    if (!sameDate || !sameTime) onChange(buffer);
    setOpen(false);
  }, [buffer, onChange, value.date, value.time]);

  const handleClear = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      onChange({ date: null, time: null });
      setOpen(false);
    },
    [onChange]
  );

  const handleToday = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      const today = toIsoDate(new Date());
      // Apply immediately — "Today" is a one-click quick action, no need to
      // route through the buffered Apply step.
      onChange({ date: today, time: buffer.time ?? null });
      setOpen(false);
    },
    [buffer.time, onChange]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-slate-900 transition-colors hover:bg-slate-50 focus:outline-none focus:border-slate-300",
              heightCls,
              !committedDate && "text-slate-400",
              isOverdue && "border-red-300 text-red-600",
              disabled && "cursor-not-allowed opacity-60",
              className
            )}
          />
        }
      >
        <CalendarIcon className={cn(iconSize, "shrink-0")} />
        {!compact && <span className="truncate">{label}</span>}
        {compact && committedDate && <span className="truncate">{label}</span>}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto border-slate-200 bg-white p-0">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1 border-slate-200 text-slate-700 hover:bg-slate-50"
            onClick={handleToday}
          >
            <CalendarIcon className="size-3.5" />
            Сегодня
          </Button>
        </div>
        <Calendar mode="single" selected={bufferedDate} onSelect={handleDate} locale={ru} />
        <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-2">
          <Clock className="size-3.5 text-slate-400" />
          <input
            type="time"
            value={buffer.time ?? ""}
            onChange={(e) => handleTime(e.target.value)}
            disabled={!buffer.date}
            className="h-7 flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50 focus:outline-none focus:border-slate-300 disabled:cursor-not-allowed disabled:bg-slate-50"
            placeholder="—:—"
          />
          {buffer.time && (
            <button
              type="button"
              onClick={() => handleTime("")}
              className="text-xs text-slate-400 hover:text-slate-600"
              title="Убрать время"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-2">
          {value.date && (
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-slate-500 hover:text-slate-900"
              onClick={handleClear}
            >
              Убрать срок
            </Button>
          )}
          <Button
            size="sm"
            className="flex-1 gap-1 bg-blue-500 text-white hover:bg-blue-600"
            onClick={handleApply}
          >
            <Check className="size-3.5" />
            Применить
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
