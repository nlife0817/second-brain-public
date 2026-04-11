"use client";

import { useEffect, useMemo, useState } from "react";
import { useBrainStore } from "@/lib/store";
import { MobileDayTaskCard } from "@/components/mobile/MobileDayTaskCard";
import { CheckSquare, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { format, addDays, subDays, isToday, isTomorrow, isYesterday } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";

function formatDayLabel(date: Date): string {
  if (isToday(date)) return "Сегодня";
  if (isTomorrow(date)) return "Завтра";
  if (isYesterday(date)) return "Вчера";
  return format(date, "d MMMM", { locale: ru });
}

export default function MobileTasksPage() {
  const fetchInit = useBrainStore((s) => s.fetchInit);
  const items = useBrainStore((s) => s.items);

  const [selectedDate, setSelectedDate] = useState(new Date());
  const dateStr = format(selectedDate, "yyyy-MM-dd");

  useEffect(() => {
    fetchInit();
  }, [fetchInit]);

  const dayItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.due_date === dateStr &&
          item.status !== "archived" &&
          !item.parent_id
      ),
    [items, dateStr]
  );

  const overdueItems = useMemo(
    () =>
      isToday(selectedDate)
        ? items.filter(
            (item) =>
              item.due_date &&
              item.due_date < dateStr &&
              item.status !== "done" &&
              item.status !== "archived" &&
              !item.parent_id
          )
        : [],
    [items, dateStr, selectedDate]
  );

  const isCurrentDay = isToday(selectedDate);

  return (
    <div className="min-h-full bg-background">
      {/* Header with date navigation */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="px-4 py-3">
          {/* Top row: icon + title */}
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-violet-100 dark:bg-violet-950">
              <CheckSquare className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight text-foreground">Задачи на день</h1>
              <p className="text-xs text-muted-foreground">Просмотр по дате</p>
            </div>
          </div>

          {/* Date navigator */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedDate((d) => subDays(d, 1))}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-border bg-muted/50 text-foreground transition-colors active:bg-muted"
              aria-label="Предыдущий день"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <button
              onClick={() => setSelectedDate(new Date())}
              className={cn(
                "flex flex-1 flex-col items-center rounded-2xl border px-4 py-2.5 transition-colors",
                isCurrentDay
                  ? "border-violet-400 bg-violet-600 text-white"
                  : "border-border bg-muted/50 text-foreground hover:bg-muted"
              )}
            >
              <span className="text-base font-bold leading-tight">
                {formatDayLabel(selectedDate)}
              </span>
              <span className={cn(
                "text-xs leading-none",
                isCurrentDay ? "text-violet-200" : "text-muted-foreground"
              )}>
                {format(selectedDate, "EEEE, d MMMM", { locale: ru })}
              </span>
            </button>

            <button
              onClick={() => setSelectedDate((d) => addDays(d, 1))}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-border bg-muted/50 text-foreground transition-colors active:bg-muted"
              aria-label="Следующий день"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-4 py-5">
        {/* Overdue section (only on today) */}
        {overdueItems.length > 0 && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <p className="text-xs font-bold uppercase tracking-widest text-red-500">
                Просрочено
              </p>
              <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-100 px-1.5 text-xs font-bold text-red-600 dark:bg-red-950 dark:text-red-400">
                {overdueItems.length}
              </span>
            </div>
            <div className="space-y-2.5">
              {overdueItems.map((item) => (
                <MobileDayTaskCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

        {/* Day tasks section */}
        {dayItems.length > 0 ? (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-violet-500" />
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {formatDayLabel(selectedDate)}
              </p>
              <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-violet-100 px-1.5 text-xs font-bold text-violet-600 dark:bg-violet-950 dark:text-violet-400">
                {dayItems.length}
              </span>
            </div>
            <div className="space-y-2.5">
              {dayItems.map((item) => (
                <MobileDayTaskCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-muted">
              <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="font-semibold text-foreground">Задач нет</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Нет задач с дедлайном на {formatDayLabel(selectedDate).toLowerCase()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
