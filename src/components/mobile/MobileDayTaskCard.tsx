"use client";

import { useState } from "react";
import { useBrainStore } from "@/lib/store";
import { ChevronDown, ChevronUp } from "lucide-react";
import { STATUS_CONFIG, PRIORITY_CONFIG } from "@/types";
import type { ItemWithSubtasks, ItemStatus } from "@/types";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: ItemStatus[] = ["inbox", "todo", "in_progress", "review", "done"];

interface Props {
  item: ItemWithSubtasks;
}

export function MobileDayTaskCard({ item }: Props) {
  const [expanded, setExpanded] = useState(false);
  const updateItem = useBrainStore((s) => s.updateItem);

  const statusCfg = STATUS_CONFIG[item.status];
  const priorityCfg = PRIORITY_CONFIG[item.priority];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* Card header — always visible */}
      <button
        type="button"
        className="flex w-full items-start gap-3 p-4 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug text-card-foreground">{item.title}</p>

          {/* Tags row */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                statusCfg.color
              )}
            >
              {statusCfg.label}
            </span>

            {item.priority !== "none" && (
              <span className={cn("text-xs font-medium", priorityCfg.color)}>
                {priorityCfg.icon} {priorityCfg.label}
              </span>
            )}

            {item.due_date && (
              <span className="text-xs text-muted-foreground">
                {format(parseISO(item.due_date), "d MMM", { locale: ru })}
              </span>
            )}

            {item.category && item.category !== "other" && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {item.category}
              </span>
            )}
          </div>
        </div>

        <div className="ml-2 mt-0.5 flex-shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {item.description && (
            <p className="mb-3 text-sm text-muted-foreground">{item.description}</p>
          )}

          {/* Quick status change */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Статус
            </p>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => updateItem(item.id, { status: s })}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium transition-opacity",
                    STATUS_CONFIG[s].color,
                    item.status === s ? "ring-2 ring-offset-1 ring-violet-500" : "opacity-70"
                  )}
                >
                  {STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
