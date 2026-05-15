"use client";

import { ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBrainStore } from "@/lib/store";
import type { WeeklyPlan } from "@/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

function formatWeekRange(plan: WeeklyPlan): string {
  const start = new Date(plan.week_start + "T00:00:00");
  const end = new Date(plan.week_end + "T00:00:00");
  const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

  const startDay = start.getDate();
  const endDay = end.getDate();
  const startMonth = months[start.getMonth()];
  const endMonth = months[end.getMonth()];
  const year = end.getFullYear();

  if (startMonth === endMonth) {
    return `${startDay} — ${endDay} ${endMonth} ${year}`;
  }
  return `${startDay} ${startMonth} — ${endDay} ${endMonth} ${year}`;
}

interface Props {
  onCreateNew: () => void;
}

export function WeeklyPlanSelector({ onCreateNew }: Props) {
  const weeklyPlans = useBrainStore((s) => s.weeklyPlans);
  const currentPlan = useBrainStore((s) => s.currentPlan);
  const fetchCurrentPlan = useBrainStore((s) => s.fetchCurrentPlan);

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="gap-1.5 text-sm font-medium" />
          }
        >
          {currentPlan ? formatWeekRange(currentPlan) : "Выберите план"}
          <ChevronDown className="size-3.5 text-slate-400" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[280px] p-1 bg-white">
          <ScrollArea className="max-h-[300px]">
            {weeklyPlans.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">Нет планов</p>
            ) : (
              weeklyPlans.map((plan) => (
                <button
                  key={plan.id}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-md hover:bg-slate-50 transition-colors",
                    currentPlan?.id === plan.id && "bg-slate-100 font-medium"
                  )}
                  onClick={() => fetchCurrentPlan(plan.id)}
                >
                  <span className="flex-1">{formatWeekRange(plan)}</span>
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded-full",
                    plan.status === "active" ? "bg-emerald-100 text-emerald-700" :
                    plan.status === "completed" ? "bg-slate-100 text-slate-500" :
                    "bg-gray-100 text-gray-500"
                  )}>
                    {plan.status === "active" ? "Активный" : plan.status === "completed" ? "Завершён" : "Архив"}
                  </span>
                </button>
              ))
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>

      <Button variant="outline" size="icon-xs" onClick={onCreateNew} className="text-slate-400 hover:text-slate-600">
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

export { formatWeekRange };
