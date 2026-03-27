"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useBrainStore } from "@/lib/store";
import {
  CATEGORY_CONFIG,
  PRIORITY_CONFIG,
  TYPE_CONFIG,
  ItemCategory,
  ItemPriority,
  ItemType,
} from "@/types";
import { Search, X, SlidersHorizontal, ChevronDown, Check, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AdvancedFilterBuilder } from "@/components/filters/AdvancedFilterBuilder";

/* -------------------------------------------------------------------------- */
/*  Main FilterBar                                                            */
/* -------------------------------------------------------------------------- */

export function FilterBar() {
  const filters = useBrainStore((s) => s.filters);
  const setFilters = useBrainStore((s) => s.setFilters);
  const resetFilters = useBrainStore((s) => s.resetFilters);
  const toggleAdvancedFilters = useBrainStore((s) => s.toggleAdvancedFilters);

  const hasActiveFilters =
    filters.search.length > 0 ||
    filters.categories.length > 0 ||
    filters.priorities.length > 0 ||
    filters.types.length > 0 ||
    filters.showArchived ||
    (filters.useAdvanced && filters.advancedGroups.length > 0);

  /* Debounced search */
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchValue, setSearchValue] = useState(filters.search);

  // Keep local search in sync when store is reset externally
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

  /* Active filter badges */
  const activeBadges: Array<{ key: string; label: string; onRemove: () => void }> = [];

  for (const cat of filters.categories) {
    activeBadges.push({
      key: `cat-${cat}`,
      label: CATEGORY_CONFIG[cat].label,
      onRemove: () =>
        setFilters({
          categories: filters.categories.filter((c) => c !== cat),
        }),
    });
  }
  for (const pri of filters.priorities) {
    activeBadges.push({
      key: `pri-${pri}`,
      label: PRIORITY_CONFIG[pri].label,
      onRemove: () =>
        setFilters({
          priorities: filters.priorities.filter((p) => p !== pri),
        }),
    });
  }
  for (const typ of filters.types) {
    activeBadges.push({
      key: `type-${typ}`,
      label: TYPE_CONFIG[typ].label,
      onRemove: () =>
        setFilters({
          types: filters.types.filter((t) => t !== typ),
        }),
    });
  }
  if (filters.showArchived) {
    activeBadges.push({
      key: "archived",
      label: "Архив",
      onRemove: () => setFilters({ showArchived: false }),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ---- Top row: search + filter dropdowns ----------------------------- */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-[360px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <Input
            value={searchValue}
            onChange={(e) => handleSearch((e.target as HTMLInputElement).value)}
            placeholder="Поиск..."
            className="pl-8 pr-8 h-8 border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400"
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

        <Separator orientation="vertical" className="h-5 mx-0.5 hidden sm:block bg-slate-200" />

        {/* Category filter */}
        <MultiSelectFilter<ItemCategory>
          label="Категория"
          options={Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => ({
            value: key as ItemCategory,
            label: cfg.label,
          }))}
          selected={filters.categories}
          onChange={(categories) => setFilters({ categories })}
        />

        {/* Priority filter */}
        <MultiSelectFilter<ItemPriority>
          label="Приоритет"
          options={Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => ({
            value: key as ItemPriority,
            label: `${cfg.icon} ${cfg.label}`,
          }))}
          selected={filters.priorities}
          onChange={(priorities) => setFilters({ priorities })}
        />

        {/* Type filter */}
        <MultiSelectFilter<ItemType>
          label="Тип"
          options={Object.entries(TYPE_CONFIG).map(([key, cfg]) => ({
            value: key as ItemType,
            label: cfg.label,
          }))}
          selected={filters.types}
          onChange={(types) => setFilters({ types })}
        />

        <Separator orientation="vertical" className="h-5 mx-0.5 hidden sm:block bg-slate-200" />

        {/* Show archived toggle */}
        <Button
          variant={filters.showArchived ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setFilters({ showArchived: !filters.showArchived })}
          className={cn(
            "text-xs gap-1.5 h-8",
            filters.showArchived && "ring-1 ring-slate-300"
          )}
        >
          <SlidersHorizontal className="size-3.5" />
          Архив
        </Button>

        {/* Advanced filters toggle */}
        <Button
          variant={filters.useAdvanced ? "secondary" : "ghost"}
          size="sm"
          onClick={() => toggleAdvancedFilters()}
          className={cn(
            "text-xs gap-1.5 h-8",
            filters.useAdvanced && "ring-1 ring-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
          )}
        >
          <Layers className="size-3.5" />
          Расширенные
        </Button>

        {/* Clear all */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              resetFilters();
              setSearchValue("");
            }}
            className="text-xs text-slate-500 hover:text-red-600 gap-1 h-8 ml-auto"
          >
            <X className="size-3.5" />
            Сбросить все
          </Button>
        )}
      </div>

      {/* ---- Active filter badges ----------------------------------------- */}
      {activeBadges.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-slate-500 mr-1">Фильтры:</span>
          {activeBadges.map((badge) => (
            <Badge
              key={badge.key}
              variant="secondary"
              className="text-[11px] gap-1 pl-2 pr-1 py-0.5 rounded-md cursor-pointer border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
            >
              {badge.label}
              <button
                type="button"
                onClick={badge.onRemove}
                className="ml-0.5 rounded-sm p-0.5 hover:bg-slate-200 transition-colors"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* ---- Advanced filter builder --------------------------------------- */}
      {filters.useAdvanced && <AdvancedFilterBuilder />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Multi-select filter dropdown                                              */
/* -------------------------------------------------------------------------- */

interface MultiSelectFilterProps<T extends string> {
  label: string;
  options: Array<{ value: T; label: string }>;
  selected: T[];
  onChange: (selected: T[]) => void;
}

function MultiSelectFilter<T extends string>({
  label,
  options,
  selected,
  onChange,
}: MultiSelectFilterProps<T>) {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(
    (value: T) => {
      if (selected.includes(value)) {
        onChange(selected.filter((v) => v !== value));
      } else {
        onChange([...selected, value]);
      }
    },
    [selected, onChange]
  );

  const count = selected.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant={count > 0 ? "outline" : "ghost"}
            size="sm"
            className={cn(
              "text-xs gap-1 h-8",
              count > 0 && "ring-1 ring-blue-200 border-blue-200"
            )}
          />
        }
      >
        {label}
        {count > 0 && (
          <Badge
            variant="default"
            className="ml-0.5 size-4 p-0 text-[10px] rounded-full flex items-center justify-center"
          >
            {count}
          </Badge>
        )}
        <ChevronDown
          className={cn(
            "size-3 opacity-50 transition-transform",
            open && "rotate-180"
          )}
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-52 border-slate-200 bg-white p-1.5"
        align="start"
        sideOffset={6}
      >
        <div className="flex flex-col gap-0.5">
          {options.map((option) => {
            const isSelected = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                className={cn(
                  "flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-sm text-left transition-colors",
                  isSelected
                    ? "bg-blue-50 text-slate-900"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <Checkbox
                  checked={isSelected}
                  className="pointer-events-none"
                />
                <span className="flex-1 truncate">{option.label}</span>
                {isSelected && (
                  <Check className="size-3.5 text-blue-500 shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Clear selection for this filter */}
        {count > 0 && (
          <>
            <Separator className="my-1.5 bg-slate-200" />
            <button
              type="button"
              onClick={() => onChange([])}
              className="flex items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-900 transition-colors"
            >
              <X className="size-3" />
              Сбросить
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
