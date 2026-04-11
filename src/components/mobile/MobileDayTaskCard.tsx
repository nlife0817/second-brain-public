"use client";

import { useState } from "react";
import { useBrainStore } from "@/lib/store";
import { ChevronDown, ChevronUp, Building2, CheckSquare } from "lucide-react";
import { STATUS_CONFIG, PRIORITY_CONFIG } from "@/types";
import type { ItemWithSubtasks, ItemStatus } from "@/types";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: ItemStatus[] = ["inbox", "todo", "in_progress", "review", "done"];

interface Props {
  item: ItemWithSubtasks;
}

export function MobileDayTaskCard({ item }: Props) {
  const [expanded, setExpanded] = useState(false);
  const updateItem = useBrainStore((s) => s.updateItem);
  const itemLinkedClients = useBrainStore((s) => s.itemLinkedClients);
  const clientNames = itemLinkedClients[item.id] ?? [];

  const statusCfg = STATUS_CONFIG[item.status];
  const priorityCfg = PRIORITY_CONFIG[item.priority];
  const subtasks = item.subtasks ?? [];
  const doneSubtasks = subtasks.filter((s) => s.status === "done").length;

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
            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", statusCfg.color)}>
              {statusCfg.label}
            </span>

            {item.priority !== "none" && (
              <span className={cn("text-xs font-medium", priorityCfg.color)}>
                {priorityCfg.icon} {priorityCfg.label}
              </span>
            )}

            {subtasks.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                <CheckSquare className="h-3 w-3" />
                {doneSubtasks}/{subtasks.length}
              </span>
            )}

            {clientNames.map((name) => (
              <span key={name} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                <Building2 className="h-3 w-3" />
                {name}
              </span>
            ))}
          </div>
        </div>

        <div className="ml-2 mt-0.5 flex-shrink-0 text-muted-foreground">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
          {item.description && (
            <p className="text-sm text-muted-foreground">{item.description}</p>
          )}

          {/* Subtasks list */}
          {subtasks.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Подзадачи
              </p>
              <div className="space-y-1.5">
                {subtasks.map((sub) => (
                  <div key={sub.id} className="flex items-center gap-2">
                    <span className={cn(
                      "h-2 w-2 flex-shrink-0 rounded-full",
                      sub.status === "done" ? "bg-green-500" : "bg-muted-foreground/40"
                    )} />
                    <span className={cn(
                      "text-sm",
                      sub.status === "done" ? "text-muted-foreground line-through" : "text-foreground"
                    )}>
                      {sub.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick status change */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
