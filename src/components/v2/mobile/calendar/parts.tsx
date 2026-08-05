"use client";

// Общие части мобильного календаря: плашка на сетке, строка списка дня и лист
// с деталями внешнего события.
//
// Плашка отличается от десктопной ровно одним: у неё нет ни ручек растягивания,
// ни жеста перетаскивания. На телефоне полотно только показывает — даты правятся
// в карточке задачи, куда ведёт тап. Полоса, которую можно потянуть пальцем,
// конфликтовала бы с прокруткой и с листанием периода.

import { ExternalLink, MapPin, X } from "lucide-react";
import type { CSSProperties } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { chipStyle } from "@/components/v2/bits";
import { itemTimeLabel, type CalendarItem } from "@/lib/core/calendar";
import { MONTHS_OF, dayOfMonth, monthIndex } from "@/lib/core/days";
import type { CalendarBrief, CalendarEventRow } from "@/lib/core/types";
import { cn } from "@/lib/utils";

/** Цвет события календаря, у которого своего цвета нет. */
export const DEFAULT_EVENT_COLOR = "#7c8ba1";

export function itemColor(item: CalendarItem): string {
  return item.color ?? DEFAULT_EVENT_COLOR;
}

/**
 * Плашка задачи или события. `dense` — колонка недели шириной в палец: там
 * подпись времени не помещается и только мешает названию.
 */
export function CalendarChip({
  item,
  variant,
  dense = false,
  style,
  className,
  onOpen,
}: {
  item: CalendarItem;
  /** `bar` — полоса по дням, `block` — блок в часовой сетке. */
  variant: "bar" | "block";
  dense?: boolean;
  style?: CSSProperties;
  className?: string;
  onOpen: (item: CalendarItem) => void;
}) {
  const time = itemTimeLabel(item);
  const color = itemColor(item);

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      style={{ ...chipStyle(color), ...style }}
      className={cn(
        "tinted-chip relative flex w-full min-w-0 select-none overflow-hidden rounded-md pl-1.5 pr-1 text-left leading-tight",
        variant === "block" ? "flex-col items-start justify-start gap-0.5 py-0.5" : "items-center gap-1",
        dense ? "text-[9px]" : "text-[11px]",
        item.done && "opacity-60",
        item.invalid && "ring-1 ring-inset ring-destructive",
        className,
      )}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: color }} />
      <span className={cn("flex min-w-0 items-center gap-1 pl-1", variant === "block" && "w-full")}>
        {item.kind === "event" && !dense && <ExternalLink className="size-2.5 shrink-0 opacity-70" />}
        <span className={cn("truncate font-medium", item.done && "line-through")}>{item.title}</span>
      </span>
      {time && !dense && (
        <span
          className={cn(
            "shrink-0 pl-1 tabular-nums opacity-80",
            // Выведенный край не должен читаться как заданный.
            (item.inferredEnd || item.inferredStart) && "italic",
          )}
        >
          {time}
        </span>
      )}
    </button>
  );
}

/** Строка списка дня: время слева, название справа — как в повестке телефона. */
export function AgendaRow({ item, onOpen }: { item: CalendarItem; onOpen: (item: CalendarItem) => void }) {
  const time = itemTimeLabel(item);
  const color = itemColor(item);

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="flex w-full items-start gap-2.5 rounded-lg px-1 py-2 text-left active:bg-muted"
    >
      <span className="mt-0.5 w-14 shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {time ?? "весь день"}
      </span>
      <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", item.done && "text-muted-foreground line-through")}>
          {item.title}
        </span>
      </span>
      {item.kind === "event" && <ExternalLink className="mt-1 size-3 shrink-0 text-muted-foreground" />}
    </button>
  );
}

/**
 * Детали внешнего события. Лист снизу вместо всплывающей панели: на телефоне
 * панель у края экрана всё равно раскрывалась бы во всю ширину.
 */
export function MobileEventSheet({
  popup,
  calendar,
  onClose,
}: {
  popup: { event: CalendarEventRow; item: CalendarItem } | null;
  calendar: CalendarBrief | undefined;
  onClose: () => void;
}) {
  const dayLabel = (iso: string) => `${dayOfMonth(iso)} ${MONTHS_OF[monthIndex(iso)]}`;
  const item = popup?.item;
  const event = popup?.event;
  const time = item ? itemTimeLabel(item) : null;
  const days = item
    ? item.startDay === item.endDay
      ? dayLabel(item.startDay)
      : `${dayLabel(item.startDay)} — ${dayLabel(item.endDay)}`
    : "";

  return (
    <Sheet open={!!popup} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[80dvh] gap-0 rounded-t-2xl pb-[max(env(safe-area-inset-bottom),0.75rem)]"
      >
        {item && event && (
          <>
            <div className="flex items-start gap-2 px-4 pt-3">
              <span
                className="mt-1.5 size-3 shrink-0 rounded-[3px]"
                style={{ backgroundColor: itemColor(item) }}
              />
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-base">{item.title}</SheetTitle>
                <p className="text-xs text-muted-foreground">
                  {days}
                  {time ? `, ${time}` : ", весь день"}
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Закрыть"
                className="-mr-2 -mt-1 rounded-lg p-2 text-muted-foreground active:bg-muted"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-4 pt-3 text-sm">
              {calendar && (
                <p className="truncate text-xs text-muted-foreground">Календарь: {calendar.name}</p>
              )}
              {event.location && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">{event.location}</span>
                </p>
              )}
              {event.organizer && (
                <p className="truncate text-xs text-muted-foreground">Организатор: {event.organizer}</p>
              )}
              {event.description && (
                // Описание внешнего события — чужой текст: показываем его текстом, а
                // не разметкой, иначе это дверь для чужого HTML на нашем origin.
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">{event.description}</p>
              )}
              <p className="border-t border-border pt-2 text-[11px] text-muted-foreground">
                Это запись внешнего календаря, а не задача. Изменить её можно там, где она создана.
              </p>
              {event.html_link && (
                <a
                  href={event.html_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 pb-2 text-sm text-primary"
                >
                  <ExternalLink className="size-4" /> Открыть во внешнем календаре
                </a>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
