"use client";

import { memo, useState } from "react";
import { ChevronDown, FolderKanban, Code2, Users, FlaskConical, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WeeklyPlanEntryWithItem, ItemCategory } from "@/types";
import { CATEGORY_CONFIG } from "@/types";
import { WeeklyPlanEntryRow } from "./WeeklyPlanEntryRow";

const categoryIcons: Record<ItemCategory, typeof FolderKanban> = {
  projects: FolderKanban,
  development: Code2,
  clients: Users,
  research: FlaskConical,
  other: MoreHorizontal,
};

const categoryColors: Record<ItemCategory, string> = {
  projects: "border-l-violet-400 bg-violet-50/50",
  development: "border-l-blue-400 bg-blue-50/50",
  clients: "border-l-emerald-400 bg-emerald-50/50",
  research: "border-l-amber-400 bg-amber-50/50",
  other: "border-l-slate-400 bg-slate-50/50",
};

const categoryIconColors: Record<ItemCategory, string> = {
  projects: "text-violet-500",
  development: "text-blue-500",
  clients: "text-emerald-500",
  research: "text-amber-500",
  other: "text-slate-500",
};

interface Props {
  category: ItemCategory;
  entries: WeeklyPlanEntryWithItem[];
  planId: string;
  mode: "triage" | "review";
  onRemoveEntry?: (itemId: string) => void;
}

export const WeeklyPlanCategoryGroup = memo(function WeeklyPlanCategoryGroup({ category, entries, planId, mode, onRemoveEntry }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const cfg = CATEGORY_CONFIG[category];
  const Icon = categoryIcons[category];

  if (entries.length === 0) return null;

  const groupId = `weekly-group-${category}`;

  return (
    <div className="mb-3">
      {/* Group header — visually distinct */}
      <button
        className={cn(
          "flex items-center gap-2.5 w-full px-3 py-2 text-left rounded-md border-l-[3px] transition-colors",
          categoryColors[category],
          "hover:brightness-95"
        )}
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        aria-controls={groupId}
      >
        <ChevronDown className={cn("size-3.5 text-slate-400 transition-transform shrink-0", collapsed && "-rotate-90")} />
        <Icon className={cn("size-4 shrink-0", categoryIconColors[category])} />
        <span className="text-sm font-semibold text-slate-700">{cfg.label}</span>
        <span className="text-xs text-slate-400 tabular-nums ml-auto">({entries.length})</span>
      </button>

      {/* Entries */}
      {!collapsed && (
        <div id={groupId} className="ml-3 mt-1 pl-3 border-l-2 border-slate-100">
          {entries.map((entry) => (
            <WeeklyPlanEntryRow
              key={entry.id}
              entry={entry}
              planId={planId}
              mode={mode}
              onRemove={onRemoveEntry ? () => onRemoveEntry(entry.item_id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
});
