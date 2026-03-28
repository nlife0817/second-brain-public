"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useBrainStore } from "@/lib/store";
import type { WeeklyPlanFull } from "@/types";
import { Button } from "@/components/ui/button";
import { ClipboardList, BarChart3, CheckCircle2, Trash2, RotateCcw, Plus, ChevronDown, Rows3, ListTree, Unlink } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { formatWeekRange } from "./WeeklyPlanSelector";
import type { SubtaskDisplayMode } from "@/types";
import type { PlanViewMode } from "./WeeklyView";

const subtaskModes: { value: SubtaskDisplayMode; label: string; icon: typeof Rows3 }[] = [
  { value: "inline", label: "Встроенные", icon: Rows3 },
  { value: "accordion", label: "Аккордеон", icon: ListTree },
  { value: "detached", label: "Отдельные", icon: Unlink },
];

interface Props {
  plan: WeeklyPlanFull;
  viewMode: PlanViewMode;
  onViewModeChange: (mode: PlanViewMode) => void;
  onShowReport: () => void;
  onCreateNew: () => void;
}

export function WeeklyPlanHeader({ plan, viewMode, onViewModeChange, onShowReport, onCreateNew }: Props) {
  const weeklyPlans = useBrainStore((s) => s.weeklyPlans);
  const fetchCurrentPlan = useBrainStore((s) => s.fetchCurrentPlan);
  const updateWeeklyPlan = useBrainStore((s) => s.updateWeeklyPlan);
  const completeWeeklyPlan = useBrainStore((s) => s.completeWeeklyPlan);
  const deleteWeeklyPlan = useBrainStore((s) => s.deleteWeeklyPlan);
  const subtaskDisplayMode = useBrainStore((s) => s.subtaskDisplayMode);
  const setSubtaskDisplayMode = useBrainStore((s) => s.setSubtaskDisplayMode);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const pendingCount = plan.entries.filter((e) => e.result_status === "pending").length;

  const handleComplete = () => {
    completeWeeklyPlan(plan.id);
  };

  const handleReopen = () => {
    updateWeeklyPlan(plan.id, { status: "active" });
  };

  const handleDelete = () => {
    if (confirmDelete) {
      deleteWeeklyPlan(plan.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-200 bg-white shrink-0">
        {/* Plan selector */}
        <Popover>
          <PopoverTrigger
            render={<Button variant="outline" size="sm" className="gap-1.5 text-sm font-medium shrink-0" />}
          >
            {formatWeekRange(plan)}
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
              plan.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
            )}>
              {plan.status === "active" ? "Актив." : "Заверш."}
            </span>
            <ChevronDown className="size-3 text-slate-400" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[280px] p-1 bg-white">
            <ScrollArea className="max-h-[300px]">
              {weeklyPlans.map((p) => (
                <button
                  key={p.id}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-md hover:bg-slate-50 transition-colors",
                    plan.id === p.id && "bg-slate-100 font-medium"
                  )}
                  onClick={() => fetchCurrentPlan(p.id)}
                >
                  <span className="flex-1">{formatWeekRange(p)}</span>
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded-full",
                    p.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                  )}>
                    {p.status === "active" ? "Актив." : "Заверш."}
                  </span>
                </button>
              ))}
            </ScrollArea>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" size="icon-xs" onClick={onCreateNew} className="text-slate-400 hover:text-slate-600 shrink-0" />}>
            <Plus className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom">Новый план</TooltipContent>
        </Tooltip>

        {plan.title && (
          <span className="text-xs text-slate-500 truncate">{plan.title}</span>
        )}

        <Separator orientation="vertical" className="!h-5 bg-slate-200" />

        {/* Plan view mode toggle */}
        <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          <Button
            variant="ghost" size="sm"
            className={cn("gap-1 text-xs rounded-md text-slate-400 hover:text-slate-600", viewMode === "triage" && "bg-white text-slate-900 shadow-sm")}
            onClick={() => onViewModeChange("triage")}
          >
            <ClipboardList className="size-3.5" />
            <span className="hidden sm:inline">Планирование</span>
          </Button>
          <Button
            variant="ghost" size="sm"
            className={cn("gap-1 text-xs rounded-md text-slate-400 hover:text-slate-600", viewMode === "review" && "bg-white text-slate-900 shadow-sm")}
            onClick={() => onViewModeChange("review")}
          >
            <BarChart3 className="size-3.5" />
            <span className="hidden sm:inline">Обзор</span>
          </Button>
        </div>

        {/* Subtask display mode */}
        <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {subtaskModes.map(({ value, label, icon: Icon }) => (
              <Tooltip key={value}>
                <TooltipTrigger render={
                  <Button variant="ghost" size="icon-xs"
                    className={cn("rounded-md text-slate-400 hover:text-slate-600", subtaskDisplayMode === value && "bg-white text-slate-900 shadow-sm")}
                    onClick={() => setSubtaskDisplayMode(value)}
                  />
                }>
                  <Icon className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent side="bottom">{label}</TooltipContent>
              </Tooltip>
            ))}
          </div>

        <div className="flex-1" />

        {/* Actions */}
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" size="sm" className="gap-1 text-xs" onClick={onShowReport} />}>
            <BarChart3 className="size-3.5" />
            <span className="hidden sm:inline">Отчёт</span>
          </TooltipTrigger>
          <TooltipContent side="bottom">Отчёт за неделю</TooltipContent>
        </Tooltip>

        {plan.status === "active" ? (
          <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={handleComplete}>
            <CheckCircle2 className="size-3.5" />
            <span className="hidden sm:inline">Завершить</span>
            {pendingCount > 0 && (
              <span className="text-[10px] bg-amber-100 text-amber-700 px-1 rounded-full tabular-nums">{pendingCount}</span>
            )}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" className="gap-1 text-xs" onClick={handleReopen}>
            <RotateCcw className="size-3.5" />
            <span className="hidden sm:inline">Возобновить</span>
          </Button>
        )}

        <Button
          variant="ghost" size="icon-xs"
          className={cn("transition-colors", confirmDelete ? "text-red-600 bg-red-50 hover:bg-red-100" : "text-slate-400 hover:text-red-500")}
          onClick={handleDelete}
          aria-label={confirmDelete ? "Подтвердить удаление" : "Удалить план"}
        >
          <Trash2 className="size-3.5" />
        </Button>
        {confirmDelete && <span className="text-[10px] text-red-500 animate-pulse">Ещё раз</span>}
      </div>
    </TooltipProvider>
  );
}
