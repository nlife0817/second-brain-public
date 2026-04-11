"use client";

import { useEffect, useMemo, useState } from "react";
import { useBrainStore } from "@/lib/store";
import { MobileDayTaskCard } from "@/components/mobile/MobileDayTaskCard";
import { CheckSquare, ChevronLeft, ChevronRight } from "lucide-react";
import { format, addDays, subDays, parseISO, isToday, isTomorrow, isYesterday } from "date-fns";
import { ru } from "date-fns/locale";

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

  return (
    <div className="min-h-full bg-background">
      {/* Header with date navigation */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100">
            <CheckSquare className="h-4 w-4 text-violet-600" />
          </div>
          <div className="flex flex-1 items-center justify-between">
            <button
              onClick={() => setSelectedDate((d) => subDays(d, 1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-center">
              <div className="text-sm font-semibold leading-tight">
                {formatDayLabel(selectedDate)}
              </div>
              <div className="text-xs text-muted-foreground">
                {format(selectedDate, "EEEE", { locale: ru })}
              </div>
            </div>
            <button
              onClick={() => setSelectedDate((d) => addDays(d, 1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4 py-5">
        {/* Overdue (only on today) */}
        {overdueItems.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-500">
              Просрочено — {overdueItems.length}
            </p>
            <div className="space-y-2">
              {overdueItems.map((item) => (
                <MobileDayTaskCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

        {/* Day tasks */}
        {dayItems.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              На {formatDayLabel(selectedDate).toLowerCase()} — {dayItems.length}
            </p>
            <div className="space-y-2">
              {dayItems.map((item) => (
                <MobileDayTaskCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CheckSquare className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">Задач нет</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Нет задач с дедлайном на этот день
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
