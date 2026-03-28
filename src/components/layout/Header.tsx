"use client";

import {
  LayoutGrid,
  List,
  Plus,
  ListTree,
  Rows3,
  Unlink,
} from "lucide-react";
import { CardSettingsPopover } from "@/components/kanban/CardSettings";
import { cn } from "@/lib/utils";
import { useBrainStore, useFilteredItems } from "@/lib/store";
import type { SubtaskDisplayMode } from "@/types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

const categoryLabels: Record<string, string> = {
  all: "Все задачи",
  projects: "Проекты",
  development: "Разработка",
  clients: "Клиенты",
  research: "Исследования",
  other: "Другое",
};

const subtaskModes: { value: SubtaskDisplayMode; label: string; icon: typeof Rows3 }[] = [
  { value: "inline", label: "Встроенные", icon: Rows3 },
  { value: "accordion", label: "Аккордеон", icon: ListTree },
  { value: "detached", label: "Отдельные", icon: Unlink },
];

export function Header() {
  const viewMode = useBrainStore((s) => s.viewMode);
  const setViewMode = useBrainStore((s) => s.setViewMode);
  const openCreate = useBrainStore((s) => s.openCreate);
  const activeCategory = useBrainStore((s) => s.activeCategory);
  const subtaskDisplayMode = useBrainStore((s) => s.subtaskDisplayMode);
  const setSubtaskDisplayMode = useBrainStore((s) => s.setSubtaskDisplayMode);

  const filteredItems = useFilteredItems();
  const itemCount = filteredItems.length;

  return (
    <TooltipProvider>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight text-slate-900">
            {categoryLabels[activeCategory] ?? "Все задачи"}
          </h1>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">
            {itemCount}
          </span>
        </div>

        <div className="flex-1" />

        {/* View mode */}
        <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    "rounded-md text-slate-400 hover:text-slate-600",
                    viewMode === "kanban" && "bg-white text-slate-900 shadow-sm"
                  )}
                  onClick={() => setViewMode("kanban")}
                />
              }
            >
              <LayoutGrid className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="bottom">Канбан</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    "rounded-md text-slate-400 hover:text-slate-600",
                    viewMode === "list" && "bg-white text-slate-900 shadow-sm"
                  )}
                  onClick={() => setViewMode("list")}
                />
              }
            >
              <List className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="bottom">Список</TooltipContent>
          </Tooltip>
        </div>

        {/* Card display settings */}
        <CardSettingsPopover />

        <Separator orientation="vertical" className="!h-5 bg-slate-200" />

        {/* Subtask display mode */}
        <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {subtaskModes.map(({ value, label, icon: Icon }) => (
            <Tooltip key={value}>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      "rounded-md text-slate-400 hover:text-slate-600",
                      subtaskDisplayMode === value && "bg-white text-slate-900 shadow-sm"
                    )}
                    onClick={() => setSubtaskDisplayMode(value)}
                  />
                }
              >
                <Icon className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="bottom">{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        <Separator orientation="vertical" className="!h-5 bg-slate-200" />

        <Button
          size="sm"
          className="gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-[13px] font-medium text-white shadow-lg shadow-violet-500/20 transition-all hover:from-violet-500 hover:to-indigo-500 hover:shadow-violet-500/30"
          onClick={() => openCreate()}
        >
          <Plus className="size-3.5" />
          Новая задача
        </Button>
      </header>
    </TooltipProvider>
  );
}
