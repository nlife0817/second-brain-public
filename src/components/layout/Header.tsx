"use client";

import { useMemo } from "react";
import {
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  Plus,
  ListTree,
  Rows3,
  Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBrainStore, useFilteredItems } from "@/lib/store";
import type { ItemPriority, ItemType, SubtaskDisplayMode } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

/* -------------------------------------------------------------------------- */
/*  Config                                                                     */
/* -------------------------------------------------------------------------- */

interface FilterOption<T extends string> {
  value: T;
  label: string;
}

const priorityOptions: FilterOption<ItemPriority>[] = [
  { value: "urgent", label: "Срочно" },
  { value: "high", label: "Высокий" },
  { value: "medium", label: "Средний" },
  { value: "low", label: "Низкий" },
  { value: "none", label: "Без приоритета" },
];

const typeOptions: FilterOption<ItemType>[] = [
  { value: "task", label: "Задача" },
  { value: "note", label: "Заметка" },
  { value: "meeting", label: "Встреча" },
  { value: "plan", label: "План" },
  { value: "idea", label: "Идея" },
];

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

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function Header() {
  const viewMode = useBrainStore((s) => s.viewMode);
  const setViewMode = useBrainStore((s) => s.setViewMode);
  const filters = useBrainStore((s) => s.filters);
  const setFilters = useBrainStore((s) => s.setFilters);
  const openCreate = useBrainStore((s) => s.openCreate);
  const activeCategory = useBrainStore((s) => s.activeCategory);
  const subtaskDisplayMode = useBrainStore((s) => s.subtaskDisplayMode);
  const setSubtaskDisplayMode = useBrainStore((s) => s.setSubtaskDisplayMode);

  const filteredItems = useFilteredItems();
  const itemCount = filteredItems.length;

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.priorities.length) count += filters.priorities.length;
    if (filters.types.length) count += filters.types.length;
    return count;
  }, [filters.priorities, filters.types]);

  /* ---------------------------------------------------------------------- */
  /*  Filter helpers                                                         */
  /* ---------------------------------------------------------------------- */

  function togglePriority(priority: ItemPriority) {
    const current = filters.priorities;
    const next = current.includes(priority)
      ? current.filter((p) => p !== priority)
      : [...current, priority];
    setFilters({ priorities: next });
  }

  function toggleType(type: ItemType) {
    const current = filters.types;
    const next = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    setFilters({ types: next });
  }

  function clearAllFilters() {
    setFilters({ priorities: [], types: [] });
  }

  return (
    <TooltipProvider>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5">
        {/* ---------------------------------------------------------------- */}
        {/*  Title & count                                                    */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight text-slate-900">
            {categoryLabels[activeCategory] ?? "Все задачи"}
          </h1>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">
            {itemCount}
          </span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* ---------------------------------------------------------------- */}
        {/*  View mode toggle                                                 */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    "rounded-md text-slate-400 hover:text-slate-600",
                    viewMode === "kanban" &&
                      "bg-white text-slate-900 shadow-sm"
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
                    viewMode === "list" &&
                      "bg-white text-slate-900 shadow-sm"
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

        <Separator orientation="vertical" className="!h-5 bg-slate-200" />

        {/* ---------------------------------------------------------------- */}
        {/*  Subtask display mode toggle                                      */}
        {/* ---------------------------------------------------------------- */}
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
                      subtaskDisplayMode === value &&
                        "bg-white text-slate-900 shadow-sm"
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

        {/* ---------------------------------------------------------------- */}
        {/*  Search                                                           */}
        {/* ---------------------------------------------------------------- */}
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Поиск..."
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            className="h-8 border-slate-200 bg-slate-100 pl-8 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:border-violet-500/40 focus-visible:ring-violet-500/20"
          />
        </div>

        {/* ---------------------------------------------------------------- */}
        {/*  Filters popover                                                  */}
        {/* ---------------------------------------------------------------- */}
        <Popover>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "gap-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700",
                        activeFilterCount > 0 &&
                          "border border-violet-300 bg-violet-50 text-violet-600 hover:bg-violet-100 hover:text-violet-700"
                      )}
                    />
                  }
                />
              }
            >
              <SlidersHorizontal className="size-3.5" />
              <span className="text-[13px]">Фильтры</span>
              {activeFilterCount > 0 && (
                <span className="flex size-4 items-center justify-center rounded-full bg-violet-200 text-[10px] font-bold text-violet-700">
                  {activeFilterCount}
                </span>
              )}
            </TooltipTrigger>
            <TooltipContent side="bottom">Настроить фильтры</TooltipContent>
          </Tooltip>

          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-64 border-slate-200 bg-white p-0 shadow-xl shadow-slate-200/50"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 pt-3 pb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Фильтры
              </span>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearAllFilters}
                  className="text-[11px] font-medium text-violet-600 transition-colors hover:text-violet-500"
                >
                  Сбросить
                </button>
              )}
            </div>

            <Separator className="bg-slate-100" />

            {/* Priorities */}
            <div className="p-3">
              <span className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Приоритет
              </span>
              <div className="flex flex-col gap-2">
                {priorityOptions.map(({ value, label }) => (
                  <label
                    key={value}
                    className="group flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-0.5 transition-colors hover:bg-slate-50"
                  >
                    <Checkbox
                      checked={filters.priorities.includes(value)}
                      onCheckedChange={() => togglePriority(value)}
                      className="border-slate-300 data-checked:border-violet-500 data-checked:bg-violet-500"
                    />
                    <span className="text-[13px] text-slate-600 group-hover:text-slate-800">
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <Separator className="bg-slate-100" />

            {/* Types */}
            <div className="p-3">
              <span className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Тип
              </span>
              <div className="flex flex-col gap-2">
                {typeOptions.map(({ value, label }) => (
                  <label
                    key={value}
                    className="group flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-0.5 transition-colors hover:bg-slate-50"
                  >
                    <Checkbox
                      checked={filters.types.includes(value)}
                      onCheckedChange={() => toggleType(value)}
                      className="border-slate-300 data-checked:border-violet-500 data-checked:bg-violet-500"
                    />
                    <span className="text-[13px] text-slate-600 group-hover:text-slate-800">
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Separator orientation="vertical" className="!h-5 bg-slate-200" />

        {/* ---------------------------------------------------------------- */}
        {/*  New Task button                                                  */}
        {/* ---------------------------------------------------------------- */}
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
