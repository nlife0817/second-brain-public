"use client";

// Ряд кнопок вместо выпадающего списка. Статус и приоритет меняют чаще всего
// остального, а селект прячет и текущее значение, и соседние: чтобы сдвинуть
// задачу на шаг вперёд, нужно было открыть список и найти в нём строку.
//
// Base UI здесь не нужен — это обычные кнопки в radiogroup. Всплывающего слоя
// нет, значит нет ни портала, ни ловушки фокуса, ни возни со слоями.

import { useCallback } from "react";
import { cn } from "@/lib/utils";

/**
 * Пол ширины сегмента — по его собственной подписи, а не общим числом.
 *
 * Сегменты делят свободное место поровну, но не ужимаются короче своего текста:
 * дальше ряд начинает прокручиваться. Без пола шесть статусов на экране телефона
 * сжимались до 51 px, и от подписей не оставалось ничего; фиксированное число
 * вместо `fit-content` резало длинные названия и уводило в прокрутку даже те
 * ряды, что помещались целиком (приоритет с его короткими подписями).
 */
const MIN_SEGMENT = "min-w-fit";

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
  /**
   * Подвести выбранный сегмент в видимую часть ряда. На узком экране ряд
   * прокручивается, и задача в «Готово» открывалась бы с видом на «Входящие» —
   * без единого признака, что текущий статус вообще правее.
   *
   * Ref-колбэк, а не эффект: правило `set-state-in-effect` не отличает правку
   * состояния от прокрутки, а здесь состояния и нет — только узел, уже в DOM.
   * `block: "nearest"` обязателен, иначе браузер тянет к сегменту и всю карточку.
   */
  const revealActive = useCallback((el: HTMLButtonElement | null) => {
    if (!el) return () => {};
    const reveal = () => {
      const row = el.parentElement;
      if (!row || row.scrollWidth <= row.clientWidth) return;
      // scrollLeft вместо scrollIntoView: последний на вложенных скроллерах
      // норовит подтянуть заодно и саму карточку.
      const target = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
      row.scrollLeft = Math.max(0, Math.min(target, row.scrollWidth - row.clientWidth));
    };
    // Дважды: на монтировании карточка ещё выезжает и ряд шире, чем станет,
    // поэтому первый расчёт промахивается. Второй — когда панель села.
    const frame = requestAnimationFrame(reveal);
    const timer = setTimeout(reveal, 300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, []);

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
            ref={active ? revealActive : undefined}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange(o.value)}
            title={o.label}
            className={cn(
              // basis-0 + flex-1: сегменты делят ширину поровну, а не по длине
              // подписи — иначе «Готово» вдвое уже «К выполнению».
              // На телефоне сегмент выше: 28 px — это промах пальцем. Тот же
              // приём, что у кнопок шапки карточки (size-9 sm:size-7).
              "flex flex-1 basis-0 items-center justify-center gap-1.5 rounded-md px-2 py-2.5 text-xs transition-colors sm:py-1.5",
              MIN_SEGMENT,
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
