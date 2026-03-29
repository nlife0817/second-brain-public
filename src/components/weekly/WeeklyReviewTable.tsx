"use client";

import { useMemo, useEffect } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBrainStore } from "@/lib/store";
import type { WeeklyPlanFull, ItemCategory, Item } from "@/types";
import { CATEGORY_CONFIG, PRIORITY_CONFIG } from "@/types";
import { WeeklyPlanCategoryGroup } from "./WeeklyPlanCategoryGroup";
import { ScrollArea } from "@/components/ui/scroll-area";

const CATEGORIES: ItemCategory[] = ["projects", "development", "clients", "research", "other"];

interface Props {
  plan: WeeklyPlanFull;
}

export function WeeklyReviewTable({ plan }: Props) {
  const fetchUnplannedDone = useBrainStore((s) => s.fetchUnplannedDone);
  const unplannedDoneItems = useBrainStore((s) => s.unplannedDoneItems);

  const entriesByCategory = useMemo(() => {
    const grouped: Record<ItemCategory, typeof plan.entries> = {
      projects: [], development: [], clients: [], research: [], other: [],
    };
    for (const entry of plan.entries) {
      grouped[entry.item.category].push(entry);
    }
    return grouped;
  }, [plan]);

  // Fetch unplanned done items
  useEffect(() => {
    fetchUnplannedDone(plan.id);
  }, [plan.id, fetchUnplannedDone]);

  // Group unplanned by category
  const unplannedByCategory = useMemo(() => {
    const grouped: Partial<Record<ItemCategory, Item[]>> = {};
    for (const item of unplannedDoneItems) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category]!.push(item);
    }
    return grouped;
  }, [unplannedDoneItems]);

  const hasEntries = plan.entries.length > 0;
  const hasUnplanned = unplannedDoneItems.length > 0;

  // Stats
  const doneCount = plan.entries.filter((e) => e.result_status === "done").length;
  const notDoneCount = plan.entries.filter((e) => e.result_status === "not_done").length;
  const transferredCount = plan.entries.filter((e) => e.result_status === "transferred").length;
  const pendingCount = plan.entries.filter((e) => e.result_status === "pending").length;

  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-4">
        {/* Stats bar */}
        {hasEntries && (
          <div className="flex items-center gap-4 px-4 py-2.5 bg-slate-50 rounded-lg">
            <span className="text-xs text-slate-500">Всего: <b className="text-slate-700">{plan.entries.length}</b></span>
            {doneCount > 0 && <span className="text-xs text-emerald-600">✅ {doneCount}</span>}
            {notDoneCount > 0 && <span className="text-xs text-red-500">⛔ {notDoneCount}</span>}
            {transferredCount > 0 && <span className="text-xs text-amber-500">📁 {transferredCount}</span>}
            {pendingCount > 0 && <span className="text-xs text-slate-400">⏳ {pendingCount}</span>}
            {hasUnplanned && <span className="text-xs text-violet-500">⭐ {unplannedDoneItems.length} вне плана</span>}
          </div>
        )}

        {!hasEntries && !hasUnplanned ? (
          <p className="text-sm text-slate-400 text-center py-12">
            В этом плане пока нет задач. Перейдите в режим &laquo;Планирование&raquo;, чтобы добавить.
          </p>
        ) : (
          <>
            {/* Main plan entries */}
            {hasEntries && (
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                {/* Header row */}
                <div className="hidden md:grid grid-cols-2 border-b border-slate-200 bg-slate-50">
                  <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    План
                  </div>
                  <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-l border-slate-200">
                    Результат
                  </div>
                </div>

                {CATEGORIES.map((cat) => (
                  <WeeklyPlanCategoryGroup
                    key={cat}
                    category={cat}
                    entries={entriesByCategory[cat]}
                    planId={plan.id}
                    mode="review"
                  />
                ))}
              </div>
            )}

            {/* Unplanned done section */}
            {hasUnplanned && (
              <div className="border border-violet-200 rounded-lg overflow-hidden bg-white">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-violet-50 border-b border-violet-200">
                  <Star className="size-4 text-violet-500" />
                  <span className="text-sm font-semibold text-violet-700">Выполнено вне плана</span>
                  <span className="text-xs text-violet-400 tabular-nums">({unplannedDoneItems.length})</span>
                </div>
                <div className="p-3">
                  {Object.entries(unplannedByCategory).map(([cat, items]) => (
                    <div key={cat} className="mb-2 last:mb-0">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1 px-1">
                        {CATEGORY_CONFIG[cat as ItemCategory].label}
                      </p>
                      {items!.map((item) => (
                        <UnplannedRow key={item.id} item={item} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
}

function UnplannedRow({ item }: { item: Item }) {
  const openDetail = useBrainStore((s) => s.openDetail);
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 rounded-md">
      <span className="text-xs text-emerald-500">✅</span>
      {item.priority !== "none" && (
        <span className={cn("text-xs", PRIORITY_CONFIG[item.priority].color)}>
          {PRIORITY_CONFIG[item.priority].icon}
        </span>
      )}
      <button
        className="text-sm text-slate-700 truncate hover:text-slate-900 text-left"
        onClick={() => openDetail(item.id)}
      >
        {item.title}
      </button>
    </div>
  );
}
