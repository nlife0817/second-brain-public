"use client";

import { memo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WeeklyPlanEntryWithItem } from "@/types";
import { useCategoryConfig } from "@/lib/store";
import { ICON_MAP } from "@/lib/icon-map";
import { Folder } from "lucide-react";
import { WeeklyPlanEntryRow } from "./WeeklyPlanEntryRow";

interface Props {
  category: string;
  entries: WeeklyPlanEntryWithItem[];
  planId: string;
  mode: "triage" | "review";
  onRemoveEntry?: (itemId: string) => void;
}

export const WeeklyPlanCategoryGroup = memo(function WeeklyPlanCategoryGroup({ category, entries, planId, mode, onRemoveEntry }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const categoryConfig = useCategoryConfig();
  const cfg = categoryConfig[category];
  const Icon = ICON_MAP[cfg?.icon ?? ""] ?? Folder;

  if (entries.length === 0) return null;

  const groupId = `weekly-group-${category}`;
  const catColor = cfg?.color ?? "#6b7280";

  return (
    <div className="mb-3">
      {/* Group header */}
      <button
        className="flex items-center gap-2.5 w-full px-3 py-2 text-left rounded-md border-l-[3px] transition-colors hover:brightness-95 bg-slate-50/50"
        style={{ borderLeftColor: catColor }}
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        aria-controls={groupId}
      >
        <ChevronDown className={cn("size-3.5 text-slate-400 transition-transform shrink-0", collapsed && "-rotate-90")} />
        <Icon className="size-4 shrink-0" style={{ color: catColor }} />
        <span className="text-sm font-semibold text-slate-700">{cfg?.label ?? category}</span>
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
