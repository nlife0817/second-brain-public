"use client";

import { useMemo, useState } from "react";
import {
  Brain,
  FolderKanban,
  Code2,
  Users,
  FlaskConical,
  MoreHorizontal,
  LayoutGrid,
  List,
  Tag,
  ChevronLeft,
  ClipboardList,
  Contact,
  Settings,
  ClipboardCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBrainStore } from "@/lib/store";
import type { ItemCategory, AppSection } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

/* -------------------------------------------------------------------------- */
/*  Categories config                                                          */
/* -------------------------------------------------------------------------- */

interface CategoryEntry {
  key: ItemCategory | "all";
  label: string;
  icon: LucideIcon;
}

const categories: CategoryEntry[] = [
  { key: "all", label: "Все", icon: LayoutGrid },
  { key: "projects", label: "Проекты", icon: FolderKanban },
  { key: "development", label: "Разработка", icon: Code2 },
  { key: "clients", label: "Клиенты", icon: Users },
  { key: "research", label: "Исследования", icon: FlaskConical },
  { key: "other", label: "Другое", icon: MoreHorizontal },
];

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

interface SectionEntry {
  key: AppSection;
  label: string;
  icon: LucideIcon;
}

const sections: SectionEntry[] = [
  { key: "tasks", label: "Задачи", icon: ClipboardList },
  { key: "clients", label: "Клиенты", icon: Contact },
  { key: "staging", label: "Согласование", icon: ClipboardCheck },
  { key: "settings", label: "Настройки", icon: Settings },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  const appSection = useBrainStore((s) => s.appSection);
  const setAppSection = useBrainStore((s) => s.setAppSection);
  const activeCategory = useBrainStore((s) => s.activeCategory);
  const setActiveCategory = useBrainStore((s) => s.setActiveCategory);
  const items = useBrainStore((s) => s.items);
  const tags = useBrainStore((s) => s.tags);
  const viewMode = useBrainStore((s) => s.viewMode);
  const setViewMode = useBrainStore((s) => s.setViewMode);
  const clients = useBrainStore((s) => s.clients);
  const stagingItems = useBrainStore((s) => s.stagingItems);

  /* Count items by category */
  const counts = useMemo(() => {
    const map: Record<string, number> = { all: 0 };
    for (const item of items) {
      if (item.status === "archived") continue;
      map.all = (map.all ?? 0) + 1;
      map[item.category] = (map[item.category] ?? 0) + 1;
    }
    return map;
  }, [items]);

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "group/sidebar relative flex h-full flex-col border-r border-slate-200 bg-slate-50/80",
          "transition-[width] duration-300 ease-in-out",
          collapsed ? "w-[68px]" : "w-[260px]"
        )}
      >
        {/* ------------------------------------------------------------------ */}
        {/*  Logo / App title                                                   */}
        {/* ------------------------------------------------------------------ */}
        <div className="flex h-14 shrink-0 items-center gap-3 px-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/20">
            <Brain className="size-4 text-white" />
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight text-slate-900">
              Second Brain
            </span>
          )}
        </div>

        <Separator className="bg-slate-200" />

        {/* ------------------------------------------------------------------ */}
        {/*  Section navigation (Tasks / Clients)                               */}
        {/* ------------------------------------------------------------------ */}
        <div className="flex flex-col gap-0.5 px-2 py-2">
          {!collapsed && (
            <span className="mb-1 px-2 text-[11px] font-medium uppercase tracking-widest text-slate-400">
              Разделы
            </span>
          )}
          {sections.map(({ key, label, icon: Icon }) => {
            const isActive = appSection === key;
            const count = key === "tasks" ? items.filter((i) => i.status !== "archived").length : key === "clients" ? clients.length : key === "staging" ? stagingItems.length : 0;

            const button = (
              <button
                key={key}
                onClick={() => setAppSection(key)}
                className={cn(
                  "group/sec relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-150",
                  "outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50",
                  isActive
                    ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                    : "text-slate-600 hover:bg-white/60 hover:text-slate-800",
                  collapsed && "justify-center px-0"
                )}
              >
                {isActive && (
                  <span className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-gradient-to-b from-violet-400 to-indigo-500" />
                )}
                <Icon
                  className={cn(
                    "size-4 shrink-0 transition-colors",
                    isActive ? "text-violet-500" : "text-slate-400 group-hover/sec:text-slate-500"
                  )}
                />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate text-left">{label}</span>
                    {count > 0 && (
                      <span
                        className={cn(
                          "min-w-[20px] rounded-md px-1.5 py-0.5 text-center text-[10px] font-semibold tabular-nums leading-none",
                          isActive ? "bg-violet-100 text-violet-600" : "bg-slate-200/70 text-slate-400"
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </>
                )}
              </button>
            );

            if (collapsed) {
              return (
                <Tooltip key={key}>
                  <TooltipTrigger render={button} />
                  <TooltipContent side="right">
                    {label}
                    {count > 0 && <span className="ml-1.5 opacity-60">{count}</span>}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return button;
          })}
        </div>

        <Separator className="bg-slate-200" />

        {/* ------------------------------------------------------------------ */}
        {/*  View mode toggle (tasks only)                                      */}
        {/* ------------------------------------------------------------------ */}
        {!collapsed && appSection === "tasks" && (
          <div className="flex items-center gap-1 px-3 pt-4 pb-1">
            <span className="mr-auto text-[11px] font-medium uppercase tracking-widest text-slate-400">
              Вид
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      "text-slate-400 hover:text-slate-600",
                      viewMode === "kanban" &&
                        "bg-white text-slate-900 shadow-sm border border-slate-200"
                    )}
                    onClick={() => setViewMode("kanban")}
                  />
                }
              >
                <LayoutGrid className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top">Канбан</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      "text-slate-400 hover:text-slate-600",
                      viewMode === "list" &&
                        "bg-white text-slate-900 shadow-sm border border-slate-200"
                    )}
                    onClick={() => setViewMode("list")}
                  />
                }
              >
                <List className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top">Список</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/*  Category navigation (tasks only)                                   */}
        {/* ------------------------------------------------------------------ */}
        <ScrollArea className="flex-1 overflow-hidden">
          {appSection === "tasks" && <nav className="flex flex-col gap-0.5 px-2 py-3">
            <span
              className={cn(
                "mb-1 text-[11px] font-medium uppercase tracking-widest text-slate-400",
                collapsed ? "px-0 text-center" : "px-2"
              )}
            >
              {collapsed ? "—" : "Категории"}
            </span>

            {categories.map(({ key, label, icon: Icon }) => {
              const isActive = activeCategory === key;
              const count = counts[key] ?? 0;

              const button = (
                <button
                  key={key}
                  onClick={() => setActiveCategory(key)}
                  className={cn(
                    "group/item relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-150",
                    "outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50",
                    isActive
                      ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                      : "text-slate-600 hover:bg-white/60 hover:text-slate-800",
                    collapsed && "justify-center px-0"
                  )}
                >
                  {/* Active indicator bar */}
                  {isActive && (
                    <span className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-gradient-to-b from-violet-400 to-indigo-500" />
                  )}

                  <Icon
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      isActive ? "text-violet-500" : "text-slate-400 group-hover/item:text-slate-500"
                    )}
                  />

                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate text-left">{label}</span>
                      {count > 0 && (
                        <span
                          className={cn(
                            "min-w-[20px] rounded-md px-1.5 py-0.5 text-center text-[10px] font-semibold tabular-nums leading-none",
                            isActive
                              ? "bg-violet-100 text-violet-600"
                              : "bg-slate-200/70 text-slate-400"
                          )}
                        >
                          {count}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );

              if (collapsed) {
                return (
                  <Tooltip key={key}>
                    <TooltipTrigger render={button}>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {label}
                      {count > 0 && (
                        <span className="ml-1.5 opacity-60">{count}</span>
                      )}
                    </TooltipContent>
                  </Tooltip>
                );
              }
              return button;
            })}
          </nav>}

          {/* ---------------------------------------------------------------- */}
          {/*  Tags section (tasks only)                                        */}
          {/* ---------------------------------------------------------------- */}
          {appSection === "tasks" && !collapsed && tags.length > 0 && (
            <>
              <Separator className="mx-3 bg-slate-200" />

              <div className="px-2 py-3">
                <div className="mb-2 flex items-center gap-2 px-2">
                  <Tag className="size-3.5 text-slate-400" />
                  <span className="text-[11px] font-medium uppercase tracking-widest text-slate-400">
                    Теги
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 px-1">
                  {tags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="outline"
                      className={cn(
                        "cursor-pointer border-slate-200 bg-white text-[11px] text-slate-600",
                        "transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
                      )}
                      style={
                        tag.color
                          ? {
                              borderColor: `${tag.color}40`,
                              color: tag.color,
                              backgroundColor: `${tag.color}10`,
                            }
                          : undefined
                      }
                    >
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </ScrollArea>

        {/* ------------------------------------------------------------------ */}
        {/*  Collapse toggle                                                    */}
        {/* ------------------------------------------------------------------ */}
        <Separator className="bg-slate-200" />

        <div className="flex shrink-0 items-center justify-center p-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  onClick={() => setCollapsed((v) => !v)}
                />
              }
            >
              <ChevronLeft
                className={cn(
                  "size-4 transition-transform duration-300",
                  collapsed && "rotate-180"
                )}
              />
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? "Развернуть" : "Свернуть"}
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}
