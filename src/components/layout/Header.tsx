"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  LayoutGrid,
  List,
  Plus,
  ListTree,
  Rows3,
  Unlink,
  Search,
  X,
  SlidersHorizontal,
  Archive,
} from "lucide-react";
import { CardSettingsPopover } from "@/components/kanban/CardSettings";
import { cn } from "@/lib/utils";
import { useBrainStore, useFilteredItems } from "@/lib/store";
import type { SubtaskDisplayMode } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { AdvancedFilterBuilder } from "@/components/filters/AdvancedFilterBuilder";

const subtaskModes: { value: SubtaskDisplayMode; label: string; icon: typeof Rows3 }[] = [
  { value: "inline", label: "Встроенные", icon: Rows3 },
  { value: "accordion", label: "Аккордеон", icon: ListTree },
  { value: "detached", label: "Отдельные", icon: Unlink },
];

export function Header() {
  const viewMode = useBrainStore((s) => s.viewMode);
  const setViewMode = useBrainStore((s) => s.setViewMode);
  const openCreate = useBrainStore((s) => s.openCreate);
  const subtaskDisplayMode = useBrainStore((s) => s.subtaskDisplayMode);
  const setSubtaskDisplayMode = useBrainStore((s) => s.setSubtaskDisplayMode);
  const filters = useBrainStore((s) => s.filters);
  const setFilters = useBrainStore((s) => s.setFilters);

  const filteredItems = useFilteredItems();
  const itemCount = filteredItems.length;

  const hasAdvancedActive = filters.useAdvanced && filters.advancedGroups.length > 0;

  /* Debounced search */
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchValue, setSearchValue] = useState(filters.search);

  useEffect(() => {
    setSearchValue(filters.search);
  }, [filters.search]);

  const handleSearch = useCallback(
    (value: string) => {
      setSearchValue(value);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = setTimeout(() => {
        setFilters({ search: value });
      }, 200);
    },
    [setFilters]
  );

  return (
    <TooltipProvider>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4">
        {/* Search */}
        <div className="relative min-w-[180px] max-w-[280px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
          <Input
            value={searchValue}
            onChange={(e) => handleSearch((e.target as HTMLInputElement).value)}
            placeholder="Поиск..."
            className="pl-8 pr-8 h-8 rounded-md border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-slate-300"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => handleSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-sm text-slate-400 hover:text-slate-900 transition-colors"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Item count */}
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">
          {itemCount}
        </span>

        <Separator orientation="vertical" className="!h-5 bg-slate-200" />

        {/* Advanced filters — Popover */}
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "gap-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100",
                  hasAdvancedActive && "text-blue-600 bg-blue-50 hover:bg-blue-100 hover:text-blue-700"
                )}
              />
            }
          >
            <SlidersHorizontal className="size-3.5" />
            <span>Фильтры</span>
            {hasAdvancedActive && (
              <span className="size-1.5 rounded-full bg-blue-500" />
            )}
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={8}
            className="w-[560px] max-h-[70vh] overflow-y-auto bg-white p-0 shadow-xl border-slate-200"
          >
            <AdvancedFilterBuilder />
          </PopoverContent>
        </Popover>

        {/* Archive toggle */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={filters.showArchived ? "secondary" : "ghost"}
                size="icon-xs"
                className={cn(
                  "rounded-md text-slate-400 hover:text-slate-600",
                  filters.showArchived && "bg-white text-slate-900 shadow-sm ring-1 ring-slate-300"
                )}
                onClick={() => setFilters({ showArchived: !filters.showArchived })}
              />
            }
          >
            <Archive className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {filters.showArchived ? "Скрыть архив" : "Показать архив"}
          </TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="!h-5 bg-slate-200" />

        {/* View mode toggle */}
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

        {/* Card display settings */}
        <CardSettingsPopover />

        <div className="flex-1" />

        {/* New task */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20 transition-all hover:from-violet-500 hover:to-indigo-500"
                onClick={() => openCreate()}
              />
            }
          >
            <Plus className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="bottom">Новая задача</TooltipContent>
        </Tooltip>
      </header>
    </TooltipProvider>
  );
}
