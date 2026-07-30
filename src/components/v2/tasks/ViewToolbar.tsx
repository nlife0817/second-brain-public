"use client";

// Общие элементы шапки списка задач: счётчик, поиск и кнопка фильтров.
// Вынесены из таблицы, потому что доске проекта нужны те же самые: фильтры и
// поиск живут в общем `ViewStore`, и своя копия разметки на втором экране
// разъехалась бы с первой при первой же правке.

import { CalendarDays, Filter, GanttChartSquare, KanbanSquare, Search, Table2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FilterBuilder } from "@/components/v2/tasks/FilterBuilder";
import { useViewStore, type ProjectViewMode } from "@/lib/core/view-store";
import { cn } from "@/lib/utils";

const MODE_META: Record<ProjectViewMode, { label: string; icon: typeof Table2 }> = {
  table: { label: "Таблица", icon: Table2 },
  board: { label: "Доска", icon: KanbanSquare },
  gantt: { label: "Гант", icon: GanttChartSquare },
  calendar: { label: "Календарь", icon: CalendarDays },
};

/**
 * Переключатель вида. Состав задаёт экран: доска раскладывает задачи по
 * статусам внутри проекта, и в сводном списке всех проектов организации ей
 * делать нечего — а таблица, гант и календарь есть везде.
 */
export function ViewModeSwitch({ modes }: { modes: ProjectViewMode[] }) {
  const mode = useViewStore((s) => s.mode);
  const setMode = useViewStore((s) => s.setMode);

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {modes.map((m) => {
        const { label, icon: Icon } = MODE_META[m];
        return (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
              mode === m ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
            title={label}
          >
            <Icon className="size-3.5" />
            <span className="hidden xl:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** «12 из 40»: сколько строк осталось после фильтра и сколько их до него. */
export function TaskCount({ shown, total }: { shown: number; total: number }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
      {shown}
      {shown !== total && ` из ${total}`}
    </span>
  );
}

/** Поиск по названию. Значение — в сторе представления, общее для обоих видов. */
export function TaskSearch({ compact = false }: { compact?: boolean }) {
  const search = useViewStore((s) => s.search);
  const setSearch = useViewStore((s) => s.setSearch);

  return (
    <div className={cn("relative ml-1", compact ? "w-24" : "w-48")}>
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Поиск по названию…"
        className="h-7 w-full rounded-lg border border-input bg-transparent pl-7 pr-6 text-sm outline-none focus-visible:border-ring"
      />
      {search && (
        <button
          onClick={() => setSearch("")}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Кнопка с конструктором фильтров и счётчиком активных условий. */
export function FilterButton() {
  const filterGroups = useViewStore((s) => s.groups);
  const activeCount = filterGroups.reduce((n, g) => n + g.conditions.length, 0);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" className={cn("gap-1.5 text-xs", activeCount > 0 && "text-primary")} />
        }
      >
        <Filter className="size-3.5" />
        <span className="hidden sm:inline">Фильтры</span>
        {activeCount > 0 && (
          <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
            {activeCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70vh] w-[520px] max-w-[calc(100vw-2rem)] overflow-y-auto p-2.5">
        <FilterBuilder />
      </PopoverContent>
    </Popover>
  );
}
