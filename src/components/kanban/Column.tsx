"use client";

import React, { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { STATUS_CONFIG, ItemStatus, ItemWithSubtasks } from "@/types";
import { KanbanCard } from "./Card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface KanbanColumnProps {
  status: ItemStatus;
  items: ItemWithSubtasks[];
}

const columnBg: Record<string, string> = {
  inbox: "bg-slate-50",
  todo: "bg-blue-50/50",
  in_progress: "bg-amber-50/50",
  review: "bg-purple-50/50",
  done: "bg-emerald-50/50",
};

const headerDot: Record<string, string> = {
  inbox: "bg-slate-400",
  todo: "bg-blue-500",
  in_progress: "bg-amber-500",
  review: "bg-purple-500",
  done: "bg-emerald-500",
};

export const KanbanColumn = React.memo(function KanbanColumn({ status, items }: KanbanColumnProps) {
  const config = STATUS_CONFIG[status];

  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: {
      type: "column",
      status,
    },
  });

  const itemIds = useMemo(() => items.map((item) => item.id), [items]);

  return (
    <div
      className={cn(
        "group/column flex w-[280px] min-w-[280px] flex-col rounded-2xl",
        columnBg[status] ?? columnBg.inbox,
        "border border-slate-200",
        "transition-all duration-200",
        isOver && "border-blue-300 ring-2 ring-blue-400/40"
      )}
    >
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", headerDot[status] ?? "bg-slate-400")} />
          <h3 className="text-[13px] font-semibold text-slate-700">
            {config.label}
          </h3>
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-slate-200/70 px-1.5 text-[10px] font-semibold tabular-nums text-slate-500">
            {items.length}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ScrollArea className="h-full max-h-[calc(100vh-180px)]">
          <SortableContext
            items={itemIds}
            strategy={verticalListSortingStrategy}
          >
            <div
              ref={setNodeRef}
              className={cn(
                "flex min-h-[60px] flex-col gap-1.5 px-2 pb-2",
                "transition-colors duration-200",
                isOver && "bg-blue-50/50"
              )}
            >
              {items.map((item) => (
                <KanbanCard key={item.id} item={item} />
              ))}

              {items.length === 0 && (
                <div
                  className={cn(
                    "flex flex-col items-center justify-center rounded-xl border border-dashed py-8",
                    "border-slate-300/60",
                    "transition-colors duration-200",
                    isOver && "border-blue-400/60 bg-blue-50/30"
                  )}
                >
                  <span className="text-[11px] text-slate-400">
                    {isOver ? "Перетащите сюда" : "Нет задач"}
                  </span>
                </div>
              )}
            </div>
          </SortableContext>
        </ScrollArea>
      </div>
    </div>
  );
});
