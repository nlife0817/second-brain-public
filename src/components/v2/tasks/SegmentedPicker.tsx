"use client";

// Ряд кнопок вместо выпадающего списка. Статус и приоритет меняют чаще всего
// остального, а селект прячет и текущее значение, и соседние: чтобы сдвинуть
// задачу на шаг вперёд, нужно было открыть список и найти в нём строку.
//
// Base UI здесь не нужен — это обычные кнопки в radiogroup. Всплывающего слоя
// нет, значит нет ни портала, ни ловушки фокуса, ни возни со слоями.

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Цвет выбранного сегмента. Без него сегмент подсвечивается нейтрально. */
  color?: string;
  /** Точка слева — приоритету она нужна, статусу цвет фона достаточен. */
  dotClass?: string;
}

export function SegmentedPicker<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  ariaLabel,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  // Справочники доезжают заново при смене организации: пустой ряд рисовать
  // нечем, а «пустая рамка» читается как поломка.
  if (options.length === 0) return null;

  function move(delta: number) {
    if (disabled) return;
    const index = options.findIndex((o) => o.value === value);
    const next = options[Math.min(options.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta))];
    if (next && next.value !== value) onChange(next.value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        move(e.key === "ArrowLeft" ? -1 : 1);
      }}
      className={cn(
        "flex w-full items-stretch gap-1 overflow-x-auto rounded-lg border border-border bg-muted/40 p-1",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange(o.value)}
            title={o.label}
            className={cn(
              // basis-0 + flex-1: сегменты делят ширину поровну, а не по длине
              // подписи — иначе «Готово» вдвое уже «К выполнению».
              "flex min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors",
              active
                ? o.color
                  ? "tinted-chip font-medium"
                  : "bg-background font-medium text-foreground shadow-xs"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
              disabled && "pointer-events-none opacity-60",
            )}
            style={active && o.color ? { backgroundColor: `${o.color}22`, color: o.color } : undefined}
          >
            {o.dotClass && <span className={cn("size-2 shrink-0 rounded-full", o.dotClass)} />}
            {!o.dotClass && o.color && (
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />
            )}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
