"use client";

import { memo, useState, useMemo, useCallback } from "react";
import { Search, ChevronRight, X, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBrainStore } from "@/lib/store";
import type { ItemWithSubtasks, ItemCategory, WeeklyPlanFull } from "@/types";
import { PRIORITY_CONFIG, CATEGORY_CONFIG, STATUS_CONFIG } from "@/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { WeeklyPlanCategoryGroup } from "./WeeklyPlanCategoryGroup";
import { Calendar } from "lucide-react";

const CATEGORIES: ItemCategory[] = ["projects", "development", "clients", "research", "other"];

interface Props {
  plan: WeeklyPlanFull;
}

export function WeeklyTriageView({ plan }: Props) {
  const items = useBrainStore((s) => s.items);
  const addItemsToPlan = useBrainStore((s) => s.addItemsToPlan);
  const removeItemFromPlan = useBrainStore((s) => s.removeItemFromPlan);
  const openDetail = useBrainStore((s) => s.openDetail);

  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<ItemCategory | "all">("all");

  const isCompleted = plan.status === "completed";

  const plannedItemIds = useMemo(
    () => new Set(plan.entries.map((e) => e.item_id)),
    [plan.entries]
  );

  // Pool: only type=task, not in plan, not archived/done (п.6)
  const poolItems = useMemo(() => {
    return items.filter((item) => {
      if (item.type !== "task") return false;
      if (plannedItemIds.has(item.id)) return false;
      if (item.status === "archived" || item.status === "done") return false;
      if (filterCategory !== "all" && item.category !== filterCategory) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!item.title.toLowerCase().includes(q) && !(item.description || "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [items, plannedItemIds, filterCategory, search]);

  const entriesByCategory = useMemo(() => {
    const grouped: Record<ItemCategory, typeof plan.entries> = {
      projects: [], development: [], clients: [], research: [], other: [],
    };
    for (const entry of plan.entries) {
      grouped[entry.item.category].push(entry);
    }
    return grouped;
  }, [plan.entries]);

  const handleAddToPlan = useCallback((itemId: string) => {
    if (isCompleted) return;
    addItemsToPlan(plan.id, [itemId]);
  }, [addItemsToPlan, plan.id, isCompleted]);

  const handleRemoveFromPlan = useCallback((itemId: string) => {
    if (isCompleted) return;
    removeItemFromPlan(plan.id, itemId);
  }, [removeItemFromPlan, plan.id, isCompleted]);

  return (
    <TooltipProvider>
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden gap-4 p-4 min-h-0">
        {/* Left: Pool */}
        <div className="flex-1 flex flex-col border border-slate-200 rounded-lg bg-white overflow-hidden min-h-0">
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Пул задач</span>
              <span className="text-xs text-slate-400 tabular-nums">({poolItems.length})</span>
              {isCompleted && (
                <span className="text-[10px] text-amber-600 flex items-center gap-1">
                  <Lock className="size-3" /> План завершён
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
                  placeholder="Поиск..."
                  className="pl-7 h-7 text-xs"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label="Очистить поиск"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex gap-1 mt-2 flex-wrap">
              <button
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                  filterCategory === "all" ? "bg-slate-200 text-slate-700" : "text-slate-500 hover:bg-slate-100"
                )}
                onClick={() => setFilterCategory("all")}
              >
                Все
              </button>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                    filterCategory === cat ? "bg-slate-200 text-slate-700" : "text-slate-500 hover:bg-slate-100"
                  )}
                  onClick={() => setFilterCategory(cat)}
                >
                  {CATEGORY_CONFIG[cat].label}
                </button>
              ))}
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-1">
              {poolItems.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">Нет задач для отображения</p>
              ) : (
                poolItems.map((item) => (
                  <PoolItemRow
                    key={item.id}
                    item={item}
                    onAdd={isCompleted ? undefined : () => handleAddToPlan(item.id)}
                    onOpenDetail={() => openDetail(item.id)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right: Current plan */}
        <div className="flex-1 flex flex-col border border-slate-200 rounded-lg bg-white overflow-hidden min-h-0">
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">План на неделю</span>
              <span className="text-xs text-slate-400 tabular-nums">({plan.entries.length})</span>
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-2">
              {plan.entries.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">
                  Добавьте задачи из пула слева
                </p>
              ) : (
                CATEGORIES.map((cat) => (
                  <WeeklyPlanCategoryGroup
                    key={cat}
                    category={cat}
                    entries={entriesByCategory[cat]}
                    planId={plan.id}
                    mode="triage"
                    onRemoveEntry={isCompleted ? undefined : handleRemoveFromPlan}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </TooltipProvider>
  );
}

const PoolItemRow = memo(function PoolItemRow({ item, onAdd, onOpenDetail }: { item: ItemWithSubtasks; onAdd?: () => void; onOpenDetail: () => void }) {
  const priorityCfg = PRIORITY_CONFIG[item.priority];
  const categoryCfg = CATEGORY_CONFIG[item.category];
  const statusCfg = STATUS_CONFIG[item.status];

  const formatDueDate = (d: string | null) => {
    if (!d) return null;
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  };

  return (
    <div className="group flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 rounded-md">
      {item.priority !== "none" && (
        <span className={cn("text-xs shrink-0", priorityCfg.color)}>{priorityCfg.icon}</span>
      )}
      <button
        className="flex-1 text-left text-sm text-slate-700 truncate hover:text-slate-900 min-w-0"
        onClick={onOpenDetail}
      >
        {item.title}
      </button>
      <span className={cn("text-[10px] px-1 py-0.5 rounded shrink-0", statusCfg.color)}>{statusCfg.label}</span>
      {item.due_date && (
        <span className="text-[10px] text-slate-400 shrink-0 flex items-center gap-0.5">
          <Calendar className="size-2.5" />
          {formatDueDate(item.due_date)}
        </span>
      )}
      <span className="text-[10px] text-slate-400 shrink-0">{categoryCfg.label}</span>
      {onAdd && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-slate-400 hover:text-emerald-600 shrink-0"
                onClick={onAdd}
              />
            }
          >
            <ChevronRight className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="left">Добавить в план</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
});
