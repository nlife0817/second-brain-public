"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Clock, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

type Props = {
  value: number | null;
  onChange: (next: number | null) => void;
  placeholder?: string;
  size?: "xs" | "sm" | "md";
  className?: string;
  disabled?: boolean;
  compact?: boolean;
  align?: "start" | "center" | "end";
};

export function formatEstimate(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}ч ${m}м`;
  if (h) return `${h}ч`;
  return `${m}м`;
}

export function EstimatePicker({
  value,
  onChange,
  placeholder = "—",
  size = "sm",
  className,
  disabled,
  compact = false,
  align = "start",
}: Props) {
  const [open, setOpen] = useState(false);
  const initialH = value ? Math.floor(value / 60) : 0;
  const initialM = value ? value % 60 : 0;
  const [hours, setHours] = useState<string>(value ? String(initialH) : "");
  const [minutes, setMinutes] = useState<string>(value ? String(initialM) : "");
  const hoursRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setHours(value ? String(Math.floor(value / 60)) : "");
      setMinutes(value ? String(value % 60) : "");
      // Focus hours input on open
      setTimeout(() => hoursRef.current?.focus(), 30);
    }
  }, [open, value]);

  const heightCls =
    size === "xs" ? "h-6 text-xs" : size === "sm" ? "h-7 text-xs" : "h-8 text-sm";
  const iconSize = size === "xs" ? "size-3" : "size-3.5";

  const label = formatEstimate(value);

  const handleApply = useCallback(() => {
    const h = Math.max(0, parseInt(hours, 10) || 0);
    const m = Math.max(0, Math.min(59, parseInt(minutes, 10) || 0));
    const total = h * 60 + m;
    onChange(total > 0 ? total : null);
    setOpen(false);
  }, [hours, minutes, onChange]);

  const handleClear = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      onChange(null);
      setOpen(false);
    },
    [onChange]
  );

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleApply();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [handleApply]
  );

  const hasValue = value != null && value > 0;

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
              !hasValue && "text-slate-400",
              disabled && "cursor-not-allowed opacity-60",
              className
            )}
          />
        }
      >
        <Clock className={cn(iconSize, "shrink-0")} />
        {!compact && <span className="truncate">{label}</span>}
        {compact && hasValue && <span className="truncate">{label}</span>}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto border-slate-200 bg-white p-0">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <input
            ref={hoursRef}
            type="number"
            min={0}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            onKeyDown={handleKey}
            placeholder="0"
            className="h-7 w-14 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50 focus:outline-none focus:border-slate-300"
          />
          <span className="text-xs text-slate-500">ч</span>
          <input
            type="number"
            min={0}
            max={59}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            onKeyDown={handleKey}
            placeholder="0"
            className="h-7 w-14 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50 focus:outline-none focus:border-slate-300"
          />
          <span className="text-xs text-slate-500">м</span>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-2">
          {hasValue && (
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-slate-500 hover:text-slate-900"
              onClick={handleClear}
            >
              <X className="size-3.5" />
              Очистить
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
