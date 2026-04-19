"use client";

import { useState, useCallback } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarIcon, Clock, X } from "lucide-react";
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
}: Props) {
  const [open, setOpen] = useState(false);
  const date = parseDate(value.date);
  const isOverdue = date && (() => {
    const now = new Date();
    if (value.time && /^\d{2}:\d{2}$/.test(value.time)) {
      const [h, m] = value.time.split(":").map((p) => parseInt(p, 10));
      const deadline = new Date(date);
      deadline.setHours(h, m, 0, 0);
      return deadline < now;
    }
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay < now;
  })();

  const heightCls = size === "xs" ? "h-6 text-xs" : size === "sm" ? "h-7 text-xs" : "h-8 text-sm";
  const iconSize = size === "xs" ? "size-3" : "size-3.5";

  const label = date
    ? value.time && /^\d{2}:\d{2}$/.test(value.time)
      ? `${format(date, "d MMM", { locale: ru })} · ${value.time}`
      : format(date, "d MMM yyyy", { locale: ru })
    : placeholder;

  const handleDate = useCallback(
    (d: Date | undefined) => {
      onChange({ date: d ? toIsoDate(d) : null, time: d ? value.time : null });
    },
    [onChange, value.time]
  );

  const handleTime = useCallback(
    (t: string) => {
      const normalized = /^\d{2}:\d{2}$/.test(t) ? t : null;
      onChange({ date: value.date, time: normalized });
    },
    [onChange, value.date]
  );

  const handleClear = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      onChange({ date: null, time: null });
      setOpen(false);
    },
    [onChange]
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
              !date && "text-slate-400",
              isOverdue && "border-red-300 text-red-600",
              disabled && "cursor-not-allowed opacity-60",
              className
            )}
          />
        }
      >
        <CalendarIcon className={cn(iconSize, "shrink-0")} />
        {!compact && <span className="truncate">{label}</span>}
        {compact && date && <span className="truncate">{label}</span>}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto border-slate-200 bg-white p-0">
        <Calendar mode="single" selected={date} onSelect={handleDate} locale={ru} />
        <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-2">
          <Clock className="size-3.5 text-slate-400" />
          <input
            type="time"
            value={value.time ?? ""}
            onChange={(e) => handleTime(e.target.value)}
            disabled={!date}
            className="h-7 flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50 focus:outline-none focus:border-slate-300 disabled:cursor-not-allowed disabled:bg-slate-50"
            placeholder="—:—"
          />
          {value.time && (
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
        {date && (
          <div className="border-t border-slate-200 px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-slate-500 hover:text-slate-900"
              onClick={handleClear}
            >
              Убрать срок
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
