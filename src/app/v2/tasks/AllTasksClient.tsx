"use client";

// «Все задачи» — сводный список по всем доступным проектам сразу.
// Данные тянутся один раз на открытие экрана; фильтрация, сортировка и
// группировка идут на клиенте, поэтому реакция на любую настройку мгновенная,
// а счётчики групп остаются честными (при серверной пагинации они бы врали).
//
// Первый список считает сервер и отдаёт в `initial` — с настройками по
// умолчанию (без завершённых и без архивных проектов). Персистентные настройки
// экрана живут в localStorage, сервер их не видит: если сохранённые отличаются
// от умолчаний, список один раз догружается уже в браузере.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Filter, Loader2, Plus, Redo2, Search, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PRIORITY_LABELS } from "@/components/v2/bits";
import { TaskSheet } from "@/components/v2/lazy";
import { BulkBar } from "@/components/v2/tasks/BulkBar";
import { FilterBuilder } from "@/components/v2/tasks/FilterBuilder";
import { TaskTable, resolveColumns, type GroupLabel } from "@/components/v2/tasks/TaskTable";
import {
  ColumnsPopover,
  GroupByPopover,
  SavedViewsMenu,
  SubtaskModePopover,
} from "@/components/v2/tasks/ViewControls";
import { api } from "@/lib/core/client";
import { cachedGet, invalidate, peek, seed } from "@/lib/core/query";
import { applyTaskChange } from "@/lib/core/task-change";
import type { AllTasksResult, TaskDetail, TaskPriority, TaskRow } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { useViewStore } from "@/lib/core/view-store";
import {
  DUE_BUCKETS,
  ESTIMATE_BUCKETS,
  GROUP_BY_LABELS,
  NONE_VALUE,
  PRIORITY_WEIGHT,
  compareTasks,
  makeMatchContext,
  matchesGroups,
  type GroupByField,
  type SortColumn,
} from "@/lib/core/views";
import { cn } from "@/lib/utils";

/** Сколько PATCH-ов уходит одновременно при массовом действии. */
const BULK_CONCURRENCY = 6;

interface UndoEntry {
  /** Предыдущие значения изменённых полей — по задаче. */
  before: Array<{ id: string; payload: Record<string, unknown> }>;
  after: Array<{ id: string; payload: Record<string, unknown> }>;
}

/** Значения тех же полей, что и в патче, но взятые из текущей строки. */
function capture(task: TaskRow, payload: Record<string, unknown>): Record<string, unknown> {
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(payload)) {
    switch (key) {
      case "assignee_ids":
        before.assignee_ids = task.assignees.map((a) => a.id);
        break;
      case "tag_ids":
        before.tag_ids = task.tags.map((t) => t.id);
        break;
      default:
        before[key] = (task as unknown as Record<string, unknown>)[key] ?? null;
    }
  }
  return before;
}

async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}

export function AllTasksClient({ initial }: { initial: AllTasksResult }) {
  const { orgId, statuses, tags, members, projects, fields, me, refreshProjects } = useV2Store();
  // Пуш и поиск умеют вести прямо на задачу.
  const deepLinkTaskId = useSearchParams().get("task");

  const columnsOrder = useViewStore((s) => s.columns);
  const widths = useViewStore((s) => s.widths);
  const sort = useViewStore((s) => s.sort);
  const groupBy = useViewStore((s) => s.groupBy);
  const filterGroups = useViewStore((s) => s.groups);
  const search = useViewStore((s) => s.search);
  const showDone = useViewStore((s) => s.showDone);
  const showArchivedProjects = useViewStore((s) => s.showArchivedProjects);
  const subtaskMode = useViewStore((s) => s.subtaskMode);
  const collapsedList = useViewStore((s) => s.collapsed);
  const setSearch = useViewStore((s) => s.setSearch);
  const setShowDone = useViewStore((s) => s.setShowDone);
  const setShowArchivedProjects = useViewStore((s) => s.setShowArchivedProjects);
  const toggleSortRaw = useViewStore((s) => s.toggleSort);
  const setWidth = useViewStore((s) => s.setWidth);
  const toggleCollapsed = useViewStore((s) => s.toggleCollapsed);

  const [tasks, setTasks] = useState<TaskRow[]>(initial.tasks);
  const [truncated, setTruncated] = useState(initial.truncated);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");

  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);

  /** Зеркало строк для колбэков: см. комментарий в patchTasks. */
  const tasksRef = useRef<TaskRow[]>(tasks);

  const path = orgId
    ? `/orgs/${orgId}/tasks?view=all${showDone ? "&done=1" : ""}${showArchivedProjects ? "&archived=1" : ""}`
    : null;
  /** Путь, который посчитал сервер: настройки по умолчанию. */
  const initialPath = orgId ? `/orgs/${orgId}/tasks?view=all` : null;

  // Серверные данные — в кэш: возврат на экран в ближайшие секунды обойдётся
  // без запроса, а первый эффект загрузки ниже увидит их уже свежими.
  useEffect(() => {
    if (initialPath) seed(initialPath, initial);
  }, [initialPath, initial]);

  const load = useCallback(
    async (opts: { force?: boolean } = {}) => {
      if (!path) return;
      // Данные уже в кэше — показываем их без индикатора: мигающая «Загрузка…»
      // на каждом возврате и есть то, что ощущается медленным интерфейсом.
      if (opts.force || peek<AllTasksResult>(path) === undefined) setLoading(true);
      try {
        const result = await cachedGet<AllTasksResult>(path, opts);
        setTasks(result.tasks);
        setTruncated(result.truncated);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить задачи");
      } finally {
        setLoading(false);
      }
    },
    [path],
  );

  const reload = useCallback(async () => {
    // После мутации кэш обеих веток (с завершёнными и без) устарел.
    if (orgId) invalidate(`/orgs/${orgId}/tasks`);
    await load({ force: true });
  }, [orgId, load]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (deepLinkTaskId) setOpenTaskId(deepLinkTaskId);
  }, [deepLinkTaskId]);

  // Обновляется после коммита — колбэки срабатывают от действий пользователя,
  // то есть заведомо позже, и видят актуальный список.
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // --- Локальное применение патча ------------------------------------------------

  const applyLocal = useCallback(
    (task: TaskRow, payload: Record<string, unknown>): TaskRow => {
      const next: TaskRow = { ...task };
      for (const [key, value] of Object.entries(payload)) {
        if (key === "assignee_ids") {
          const ids = new Set(value as string[]);
          next.assignees = members
            .filter((m) => ids.has(m.user_id))
            .map((m) => ({ id: m.user_id, email: m.email, name: m.name, avatar_url: m.avatar_url }));
        } else if (key === "tag_ids") {
          const ids = new Set(value as string[]);
          next.tags = tags.filter((t) => ids.has(t.id));
        } else {
          (next as unknown as Record<string, unknown>)[key] = value;
        }
      }
      // completed_at выводится из вида статуса — иначе строка «завершена»
      // осталась бы прежней до перезагрузки.
      if ("status_id" in payload) {
        const kind = statuses.find((s) => s.id === payload.status_id)?.kind;
        if (kind === "done" && !task.completed_at) next.completed_at = new Date().toISOString();
        if (kind !== "done" && task.completed_at) next.completed_at = null;
      }
      return next;
    },
    [members, tags, statuses],
  );

  /** Патч без записи в историю — общий шаг для правки, отмены и повтора. */
  const applyPatches = useCallback(
    async (patches: Array<{ id: string; payload: Record<string, unknown> }>) => {
      const ids = new Set(patches.map((p) => p.id));
      const byId = new Map(patches.map((p) => [p.id, p.payload]));
      setTasks((prev) =>
        prev.map((t) => (ids.has(t.id) ? applyLocal(t, byId.get(t.id) as Record<string, unknown>) : t)),
      );

      const failures: string[] = [];
      await runLimited(patches, BULK_CONCURRENCY, async ({ id, payload }) => {
        try {
          const updated = await api.patch<TaskDetail>(`/orgs/${orgId}/tasks/${id}`, payload);
          setTasks((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    title: updated.title,
                    status_id: updated.status_id,
                    priority: updated.priority,
                    due_date: updated.due_date,
                    due_time: updated.due_time,
                    estimated_minutes: updated.estimated_minutes,
                    completed_at: updated.completed_at,
                    updated_at: updated.updated_at,
                    assignees: updated.assignees,
                    tags: updated.tags,
                    placements: updated.placements,
                  }
                : t,
            ),
          );
        } catch (e) {
          failures.push(e instanceof Error ? e.message : "ошибка");
        }
      });

      if (failures.length > 0) {
        setError(`Не удалось сохранить ${failures.length} из ${patches.length}: ${failures[0]}`);
        // Оптимистичное состояние разошлось с сервером — перечитываем.
        await reload();
      } else {
        setError(null);
        // Правка живёт в состоянии экрана; в кэше остался список до неё —
        // без сброса возврат на экран показал бы старые значения.
        if (orgId) invalidate(`/orgs/${orgId}/tasks`);
      }
    },
    [applyLocal, orgId, reload],
  );

  const patchTasks = useCallback(
    async (patches: Array<{ id: string; payload: Record<string, unknown> }>) => {
      if (patches.length === 0) return;
      // Читаем строки из ref, а не из состояния: иначе patchTasks (а за ним
      // cellCtx) пересоздаётся на каждое изменение списка и memo строк
      // перестаёт работать — ровно та потеря, ради которой оно и вводилось.
      const current = new Map(tasksRef.current.map((t) => [t.id, t]));
      const entry: UndoEntry = {
        before: patches
          .filter((p) => current.has(p.id))
          .map((p) => ({ id: p.id, payload: capture(current.get(p.id)!, p.payload) })),
        after: patches,
      };
      // Глубина истории ограничена: держать всё подряд незачем, а память растёт.
      setUndoStack((prev) => [...prev.slice(-49), entry]);
      setRedoStack([]);
      await applyPatches(patches);
    },
    [applyPatches],
  );

  const patchOne = useCallback(
    (taskId: string, payload: Record<string, unknown>) => {
      void patchTasks([{ id: taskId, payload }]);
    },
    [patchTasks],
  );

  const undo = useCallback(async () => {
    const entry = undoStack.at(-1);
    if (!entry) return;
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, entry]);
    await applyPatches(entry.before);
  }, [undoStack, applyPatches]);

  const redo = useCallback(async () => {
    const entry = redoStack.at(-1);
    if (!entry) return;
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, entry]);
    await applyPatches(entry.after);
  }, [redoStack, applyPatches]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      // В поле ввода Ctrl+Z принадлежит браузеру, а не таблице.
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) void redo();
      else void undo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // --- Производные данные ---------------------------------------------------------

  const matchCtx = useMemo(() => makeMatchContext(me?.id ?? null), [me?.id]);

  const visibleTasks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = tasks.filter((t) => {
      if (needle && !t.title.toLowerCase().includes(needle)) return false;
      return matchesGroups(t, filterGroups, matchCtx);
    });
    const statusPosition = new Map(statuses.map((s) => [s.id, s.position]));
    const projectPosition = new Map(projects.map((p) => [p.id, p.position]));
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    return [...filtered].sort((a, b) =>
      compareTasks(a, b, sort, { statusPosition, projectPosition, projectName }),
    );
  }, [tasks, search, filterGroups, matchCtx, sort, statuses, projects]);

  const columns = useMemo(
    () => resolveColumns(columnsOrder, widths, fields),
    [columnsOrder, widths, fields],
  );

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const canEdit = useV2Store((s) => s.orgRole !== "guest" && s.orgRole !== null);

  const cellCtx = useMemo(
    () => ({ statuses, tags, members, projectsById, canEdit, onPatch: patchOne }),
    [statuses, tags, members, projectsById, canEdit, patchOne],
  );

  const labelForGroup = useCallback(
    (field: GroupByField, key: string): GroupLabel => {
      if (key === NONE_VALUE) {
        const empty: Record<string, string> = {
          status: "Без статуса",
          project: "Без проекта",
          assignee: "Без исполнителя",
          tag: "Без тегов",
          due: "Без срока",
          estimate: "Без оценки",
        };
        return { text: empty[field] ?? "Прочее" };
      }
      switch (field) {
        case "status": {
          const s = statuses.find((x) => x.id === key);
          return { text: s?.name ?? "Неизвестный статус", color: s?.color };
        }
        case "priority":
          return { text: PRIORITY_LABELS[key as TaskPriority]?.label ?? key };
        case "project": {
          const p = projectsById.get(key);
          return { text: p?.name ?? "Недоступный проект", color: p?.color };
        }
        case "assignee": {
          const m = members.find((x) => x.user_id === key);
          return { text: m ? m.name || m.email : "Неизвестный участник" };
        }
        case "tag": {
          const t = tags.find((x) => x.id === key);
          return { text: t?.name ?? "Неизвестный тег", color: t?.color };
        }
        case "due":
          return { text: DUE_BUCKETS.find((b) => b.key === key)?.label ?? key };
        case "estimate":
          return { text: ESTIMATE_BUCKETS.find((b) => b.key === key)?.label ?? key };
        default:
          return { text: key };
      }
    },
    [statuses, projectsById, members, tags],
  );

  const groupOrder = useCallback(
    (field: GroupByField, keys: string[]): string[] => {
      // «Пусто» всегда в конце: иначе оно всплывает в начало и отвлекает.
      const rank = (key: string): number => {
        if (key === NONE_VALUE) return Number.POSITIVE_INFINITY;
        switch (field) {
          case "status":
            return statuses.find((s) => s.id === key)?.position ?? 9998;
          case "priority":
            return PRIORITY_WEIGHT[key as TaskPriority] ?? 9998;
          case "project":
            return projectsById.get(key)?.position ?? 9998;
          case "tag":
            return tags.find((t) => t.id === key)?.position ?? 9998;
          case "due":
            return DUE_BUCKETS.findIndex((b) => b.key === key);
          case "estimate":
            return ESTIMATE_BUCKETS.findIndex((b) => b.key === key);
          default:
            return 9998;
        }
      };
      return [...keys].sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        return labelForGroup(field, a).text.localeCompare(labelForGroup(field, b).text, "ru");
      });
    },
    [statuses, projectsById, tags, labelForGroup],
  );

  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList]);

  // --- Выбор строк ------------------------------------------------------------------

  const toggleSelected = useCallback((taskId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }, []);

  const selectMany = useCallback((taskIds: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of taskIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const selectedTasks = useMemo(() => tasks.filter((t) => selected.has(t.id)), [tasks, selected]);

  const runBulk = useCallback(
    async (build: (task: TaskRow) => Record<string, unknown> | null) => {
      const patches = selectedTasks
        .map((t) => ({ id: t.id, payload: build(t) }))
        .filter((p): p is { id: string; payload: Record<string, unknown> } => p.payload !== null);
      if (patches.length === 0) return;
      setBulkBusy(true);
      try {
        await patchTasks(patches);
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedTasks, patchTasks],
  );

  const bulkDelete = useCallback(async () => {
    const ids = selectedTasks.map((t) => t.id);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const failures: string[] = [];
    await runLimited(ids, BULK_CONCURRENCY, async (id) => {
      try {
        await api.del(`/orgs/${orgId}/tasks/${id}`);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "ошибка");
      }
    });
    setBulkBusy(false);
    setSelected(new Set());
    // Удалённую задачу PATCH-ем не вернуть — историю правок обнуляем, иначе
    // «отменить» попыталось бы записать поля в несуществующую строку.
    setUndoStack([]);
    setRedoStack([]);
    if (failures.length > 0) setError(`Не удалось удалить ${failures.length} из ${ids.length}: ${failures[0]}`);
    await reload();
    await refreshProjects();
  }, [selectedTasks, orgId, reload, refreshProjects]);

  async function quickAdd() {
    if (!orgId || !quickTitle.trim()) return;
    try {
      await api.post(`/orgs/${orgId}/tasks`, { title: quickTitle.trim() });
      setQuickTitle("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать задачу");
    }
  }

  const toggleSort = useCallback((column: string) => toggleSortRaw(column as SortColumn), [toggleSortRaw]);

  const activeFilterCount = filterGroups.reduce((n, g) => n + g.conditions.length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h1 className="text-base font-semibold">Все задачи</h1>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {visibleTasks.length}
          {visibleTasks.length !== tasks.length && ` из ${tasks.length}`}
        </span>

        <div className="relative ml-1 w-48">
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

        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className={cn("gap-1.5 text-xs", activeFilterCount > 0 && "text-primary")}
              />
            }
          >
            <Filter className="size-3.5" />
            <span className="hidden sm:inline">Фильтры</span>
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-[70vh] w-[520px] overflow-y-auto p-2.5">
            <FilterBuilder />
          </PopoverContent>
        </Popover>

        <GroupByPopover />
        <SubtaskModePopover />
        <ColumnsPopover customFields={fields} />
        <SavedViewsMenu />

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            title="Отменить (Ctrl+Z)"
            disabled={undoStack.length === 0}
            onClick={() => void undo()}
          >
            <Undo2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            title="Повторить (Ctrl+Shift+Z)"
            disabled={redoStack.length === 0}
            onClick={() => void redo()}
          >
            <Redo2 className="size-3.5" />
          </Button>
        </div>

        <span className="flex-1" />

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="size-3.5 accent-primary"
          />
          Завершённые
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchivedProjects}
            onChange={(e) => setShowArchivedProjects(e.target.checked)}
            className="size-3.5 accent-primary"
          />
          Архивные проекты
        </label>
        {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </header>

      {canEdit && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
          <Plus className="size-3.5 text-muted-foreground" />
          <input
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void quickAdd()}
            placeholder="Быстро добавить задачу в личный инбокс…"
            className="h-6 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}

      {error && (
        <div className="flex shrink-0 items-center gap-2 bg-destructive/10 px-4 py-1.5 text-sm text-destructive">
          <span className="flex-1">{error}</span>
          <Button variant="ghost" size="xs" onClick={() => setError(null)}>
            Скрыть
          </Button>
        </div>
      )}
      {truncated && (
        <p className="shrink-0 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          Показаны первые 3000 задач — сузьте фильтр, чтобы увидеть остальные.
        </p>
      )}

      <div className="min-h-0 flex-1">
        {loading && tasks.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Загрузка…</p>
        ) : visibleTasks.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {tasks.length === 0
              ? "Задач пока нет."
              : `Ни одна задача не подходит под фильтр${search ? ` «${search}»` : ""}.`}
          </p>
        ) : (
          <TaskTable
            tasks={visibleTasks}
            columns={columns}
            ctx={cellCtx}
            groupBy={groupBy}
            matchCtx={matchCtx}
            subtaskMode={subtaskMode}
            sort={sort}
            onToggleSort={toggleSort}
            onResize={setWidth}
            selected={selected}
            onToggleSelected={toggleSelected}
            onSelectMany={selectMany}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            onOpen={setOpenTaskId}
            labelForGroup={labelForGroup}
            groupOrder={groupOrder}
          />
        )}
      </div>

      {selected.size > 0 && canEdit && (
        <BulkBar
          count={selected.size}
          statuses={statuses}
          tags={tags}
          members={members}
          busy={bulkBusy}
          onClear={() => setSelected(new Set())}
          onApply={(payload) => void runBulk(() => payload)}
          onAddTag={(tagId) =>
            void runBulk((t) =>
              t.tags.some((x) => x.id === tagId)
                ? null
                : { tag_ids: [...t.tags.map((x) => x.id), tagId] },
            )
          }
          onRemoveTag={(tagId) =>
            void runBulk((t) =>
              t.tags.some((x) => x.id === tagId)
                ? { tag_ids: t.tags.filter((x) => x.id !== tagId).map((x) => x.id) }
                : null,
            )
          }
          onDelete={() => void bulkDelete()}
        />
      )}

      <TaskSheet
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        onChanged={(change) => {
          if (change.type === "reload") {
            void reload();
            void refreshProjects();
            return;
          }
          setTasks((prev) => applyTaskChange(prev, change) ?? prev);
          if (change.type === "deleted" || change.confirmed) {
            if (orgId) invalidate(`/orgs/${orgId}/tasks`);
            void refreshProjects();
          }
        }}
      />

      {/* Подпись группировки для скринридеров — визуально её несёт кнопка. */}
      <span className="sr-only">
        Группировка: {GROUP_BY_LABELS[groupBy[0]]}
        {groupBy[1] !== "none" && `, затем ${GROUP_BY_LABELS[groupBy[1]]}`}
      </span>
    </div>
  );
}
