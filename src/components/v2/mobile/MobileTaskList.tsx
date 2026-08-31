"use client";

// Список задач проекта на телефоне: те же фильтры, поиск, сортировка и
// группировка из общего ViewStore, что и у таблицы, но раскладка — карточки в
// один столбец вместо колонок с горизонтальной прокруткой. Отсев и подписи
// групп — общие модули (`views.ts`, `group-naming`): один и тот же фильтр
// обязан показывать на телефоне и на десктопе одни и те же задачи.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TaskCard } from "@/components/v2/TaskCard";
import { useGroupNaming } from "@/components/v2/tasks/group-naming";
import type { TaskRow } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { useViewStore } from "@/lib/core/view-store";
import {
  GROUP_BY_LABELS,
  compareTasks,
  filterTasks,
  groupKeys,
  makeMatchContext,
  visiblePool,
  type GroupByField,
} from "@/lib/core/views";
import { cn } from "@/lib/utils";

/** Сколько карточек группа рисует сразу — как CardList на доске. */
const GROUP_PAGE = 50;

/** Поля первой группировки, осмысленные на телефоне (второго уровня нет). */
const GROUP_CHOICES: GroupByField[] = [
  "none",
  "status",
  "priority",
  "assignee",
  "tag",
  "due",
  "planned",
  "estimate",
];

/** Кнопка выбора группировки — в шапку экрана проекта. */
export function GroupByButton() {
  const groupBy = useViewStore((s) => s.groupBy);
  const setGroupBy = useViewStore((s) => s.setGroupBy);
  const active = groupBy[0] !== "none";

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs",
              active ? "text-primary" : "text-muted-foreground",
            )}
            aria-label="Группировка"
          />
        }
      >
        <Layers className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Группировать по
        </p>
        {GROUP_CHOICES.map((f) => (
          <button
            key={f}
            onClick={() => setGroupBy([f, "none"])}
            className={cn(
              "flex w-full items-center rounded px-2 py-1.5 text-sm hover:bg-muted",
              groupBy[0] === f && "bg-primary/10 font-medium text-primary",
            )}
          >
            {GROUP_BY_LABELS[f]}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function Group({
  path,
  label,
  color,
  tasks,
  grouped,
  onOpenTask,
}: {
  path: string;
  label: string;
  color?: string;
  tasks: TaskRow[];
  grouped: boolean;
  onOpenTask: (taskId: string) => void;
}) {
  const collapsedList = useViewStore((s) => s.collapsed);
  const toggleCollapsed = useViewStore((s) => s.toggleCollapsed);
  const [limit, setLimit] = useState(GROUP_PAGE);
  const isCollapsed = grouped && collapsedList.includes(path);
  const shown = tasks.length > limit ? tasks.slice(0, limit) : tasks;
  const rest = tasks.length - shown.length;

  return (
    <section>
      {grouped && (
        <button
          onClick={() => toggleCollapsed(path)}
          className="sticky top-0 z-10 -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-1.5 bg-background/95 px-1 py-2 backdrop-blur"
        >
          {isCollapsed ? (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          {color && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
          <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {tasks.length}
          </span>
        </button>
      )}
      {!isCollapsed && (
        <div className="flex flex-col gap-1.5">
          {shown.map((t) => (
            <TaskCard key={t.id} task={t} onOpen={onOpenTask} />
          ))}
          {rest > 0 && (
            <button
              onClick={() => setLimit((l) => l + GROUP_PAGE)}
              className="rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground active:bg-muted"
            >
              Показать ещё {Math.min(GROUP_PAGE, rest)} · осталось {rest}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function MobileTaskList({
  tasks,
  onOpenTask,
  emptyText,
}: {
  tasks: TaskRow[];
  onOpenTask: (taskId: string) => void;
  emptyText: string;
}) {
  const { statuses, projects, me } = useV2Store();
  const groupBy = useViewStore((s) => s.groupBy);
  const filterGroups = useViewStore((s) => s.groups);
  const search = useViewStore((s) => s.search);
  const sort = useViewStore((s) => s.sort);
  const { labelForGroup, groupOrder } = useGroupNaming();

  const matchCtx = useMemo(() => makeMatchContext(me?.id ?? null), [me?.id]);

  // Архив и завершённое прячутся до явного «Показать» — как в таблице.
  const pool = useMemo(
    () => visiblePool(tasks, filterGroups, statuses),
    [tasks, filterGroups, statuses],
  );

  const visible = useMemo(() => {
    const filtered = filterTasks(pool, filterGroups, search, matchCtx);
    const statusPosition = new Map(statuses.map((s) => [s.id, s.position]));
    const projectPosition = new Map(projects.map((p) => [p.id, p.position]));
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    return [...filtered].sort((a, b) =>
      compareTasks(a, b, sort, { statusPosition, projectPosition, projectName }),
    );
  }, [pool, filterGroups, search, matchCtx, sort, statuses, projects]);

  const field = groupBy[0];
  const groups = useMemo(() => {
    if (field === "none") {
      return [{ key: "__all__", path: "__all__", label: { text: "" }, tasks: visible }];
    }
    const buckets = new Map<string, TaskRow[]>();
    for (const task of visible) {
      // Задача с несколькими исполнителями/тегами попадает в каждую группу.
      for (const key of groupKeys(task, field, matchCtx)) {
        const arr = buckets.get(key);
        if (arr) arr.push(task);
        else buckets.set(key, [task]);
      }
    }
    return groupOrder(field, [...buckets.keys()]).map((key) => ({
      key,
      // Тот же путь, что у таблицы: свёрнутость общая для обоих видов.
      path: `${field}:${key}`,
      label: labelForGroup(field, key),
      tasks: buckets.get(key) ?? [],
    }));
  }, [visible, field, matchCtx, labelForGroup, groupOrder]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {tasks.length === 0
            ? emptyText
            : pool.length === 0
              ? "Все задачи в «Готово» или «Архиве» — включите их показ в «Фильтрах», чтобы увидеть."
              : `Ни одна задача не подходит под фильтр${search ? ` «${search}»` : ""}.`}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <Group
              key={g.path}
              path={g.path}
              label={g.label.text}
              color={g.label.color}
              tasks={g.tasks}
              grouped={field !== "none"}
              onOpenTask={onOpenTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}
