"use client";

// Экран-таблица задач: шапка с настройками представления, сама таблица и панель
// массовых действий. Общий для «Все задачи» и для проекта — визуал и повадки
// должны совпадать до мелочей, а дублировать четыреста строк логики правок,
// истории и выбора строк ради второго экрана незачем.
//
// Компонент не грузит данные и не держит карточку задачи: список принадлежит
// экрану (у сводного вида и у проекта разные источники и разные ключи кэша), а
// карточку экран открывает сам — на мобильном к ней прицеплен аппаратный
// «Назад», которому здесь делать нечего.

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Loader2, Plus, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRIORITY_LABELS } from "@/components/v2/bits";
import { BulkBar } from "@/components/v2/tasks/BulkBar";
import { TaskComposer } from "@/components/v2/tasks/TaskComposer";
import { TaskTable, resolveColumns, type GroupLabel } from "@/components/v2/tasks/TaskTable";
import { ViewSettingsPopover } from "@/components/v2/tasks/ViewControls";
import { FilterButton, TaskCount, TaskSearch } from "@/components/v2/tasks/ViewToolbar";
import { assigneeChoice } from "@/lib/core/assignable";
import { api } from "@/lib/core/client";
import { invalidate } from "@/lib/core/query";
import { emptyDraft, type TaskDraft } from "@/lib/core/task-draft";
import type { TaskDetail, TaskPriority, TaskRow } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { useViewStore } from "@/lib/core/view-store";
import {
  DUE_BUCKETS,
  ESTIMATE_BUCKETS,
  GROUP_BY_LABELS,
  NONE_VALUE,
  PRIORITY_WEIGHT,
  compareTasks,
  filterTasks,
  makeMatchContext,
  visiblePool,
  type GroupByField,
  type SortColumn,
} from "@/lib/core/views";

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
      case "project_ids":
        before.project_ids = task.placements.map((p) => p.project_id);
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

export interface TaskTableViewProps {
  tasks: TaskRow[];
  setTasks: Dispatch<SetStateAction<TaskRow[]>>;
  /** Перечитать список с сервера — нужен после удаления и при расхождении. */
  reload: () => Promise<void>;
  /** Префикс клиентского кэша, устаревающий после правки строки. */
  invalidateKey: string | null;
  /** Шапка слева: заголовок экрана и его собственные значки. */
  titleSlot: ReactNode;
  /** Шапка справа: переключатели экрана (завершённые, вид, участники). */
  actionsSlot?: ReactNode;
  loading?: boolean;
  /** Ответ упёрся в потолок выборки — предупреждаем, а не режем молча. */
  truncated?: boolean;
  /**
   * Создание задачи из строки добавления; без обработчика строки нет.
   * Черновик приходит целиком — вместе с кастомными полями, которые API
   * принимает только после создания задачи.
   */
  onCreateTask?: (draft: TaskDraft) => Promise<void>;
  /** Что экран проставляет в новый черновик (свой проект и т.п.). */
  draftDefaults?: Partial<TaskDraft>;
  /** Узкая версия строки добавления: одно поле названия. */
  quickAddPlaceholder?: string;
  /** Текст, когда задач нет вовсе (фильтр ни при чём). */
  emptyText?: string;
  /** Узкий экран: прячем то, что на телефоне бесполезно (история правок). */
  compact?: boolean;
  onOpenTask: (taskId: string) => void;
  /** Ошибка экрана — показывается той же полосой, что и ошибки правок. */
  error?: string | null;
  onDismissError?: () => void;
}

export function TaskTableView({
  tasks,
  setTasks,
  reload,
  invalidateKey,
  titleSlot,
  actionsSlot,
  loading = false,
  truncated = false,
  onCreateTask,
  draftDefaults,
  quickAddPlaceholder = "Быстро добавить задачу…",
  emptyText = "Задач пока нет.",
  compact = false,
  onOpenTask,
  error: externalError = null,
  onDismissError,
}: TaskTableViewProps) {
  const { orgId, statuses, tags, members, projects, fields, me, refreshProjects } = useV2Store();

  const columnsOrder = useViewStore((s) => s.columns);
  const widths = useViewStore((s) => s.widths);
  const sort = useViewStore((s) => s.sort);
  const groupBy = useViewStore((s) => s.groupBy);
  const filterGroups = useViewStore((s) => s.groups);
  const search = useViewStore((s) => s.search);
  const subtaskMode = useViewStore((s) => s.subtaskMode);
  const wrapTitle = useViewStore((s) => s.wrapTitle);
  const collapsedList = useViewStore((s) => s.collapsed);
  const toggleSortRaw = useViewStore((s) => s.toggleSort);
  const setWidth = useViewStore((s) => s.setWidth);
  const toggleCollapsed = useViewStore((s) => s.toggleCollapsed);

  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");

  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);

  /** Зеркало строк для колбэков: см. комментарий в patchTasks. */
  const tasksRef = useRef<TaskRow[]>(tasks);

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
        } else if (key === "project_ids") {
          // Позиция внутри проекта у прежних размещений сохраняется: правка из
          // таблицы меняет состав проектов, а не место на доске.
          next.placements = (value as string[]).map(
            (projectId) =>
              task.placements.find((p) => p.project_id === projectId) ?? {
                project_id: projectId,
                position: 0,
              },
          );
        } else {
          (next as unknown as Record<string, unknown>)[key] = value;
        }
      }
      // completed_at выводится из категории статуса — иначе строка «завершена»
      // осталась бы прежней до перезагрузки.
      if ("status_id" in payload) {
        const category = statuses.find((s) => s.id === payload.status_id)?.category;
        if (category === "done" && !task.completed_at) next.completed_at = new Date().toISOString();
        if (category !== "done" && task.completed_at) next.completed_at = null;
      }
      return next;
    },
    [members, tags, statuses],
  );

  /**
   * Отправка одного патча. `project_ids` — виртуальное поле, как `assignee_ids`
   * и `tag_ids`: состав проектов PATCH задачи не принимает, его задаёт
   * отдельный PUT размещений. Держим его в общем конвейере — иначе правка
   * проекта выпадает и из истории Ctrl+Z, и из общей обработки ошибок.
   */
  const sendPatch = useCallback(
    async (taskId: string, payload: Record<string, unknown>): Promise<TaskDetail | null> => {
      const { project_ids: projectIds, ...rest } = payload;
      let updated: TaskDetail | null = null;
      if (Array.isArray(projectIds)) {
        const placements = (projectIds as string[]).map((project_id) => ({ project_id }));
        updated = await api.put<TaskDetail>(`/orgs/${orgId}/tasks/${taskId}/placements`, { placements });
      }
      if (Object.keys(rest).length > 0) {
        updated = await api.patch<TaskDetail>(`/orgs/${orgId}/tasks/${taskId}`, rest);
      }
      return updated;
    },
    [orgId],
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
          const updated = await sendPatch(id, payload);
          // Пустой патч уходить наружу не должен, но если ушёл — сливать в
          // строку нечего.
          if (!updated) return;
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
        if (invalidateKey) invalidate(invalidateKey);
      }
    },
    [applyLocal, sendPatch, reload, setTasks, invalidateKey],
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

  const setPlacements = useCallback(
    (taskId: string, projectIds: string[]) => {
      void patchTasks([{ id: taskId, payload: { project_ids: projectIds } }]);
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

  /**
   * Архив и завершённое прячутся до явного «Архив/Готово = Показать»: иначе
   * прошлое всплывает в каждой группировке. Отсев идёт отдельным шагом, а не
   * внутри общего фильтра: это умолчание экрана, и в счётчике «N из M» ему
   * делать нечего — иначе список без единого условия показывал бы «12 из 40».
   */
  const pool = useMemo(
    () => visiblePool(tasks, filterGroups, statuses),
    [tasks, filterGroups, statuses],
  );

  const visibleTasks = useMemo(() => {
    const filtered = filterTasks(pool, filterGroups, search, matchCtx);
    const statusPosition = new Map(statuses.map((s) => [s.id, s.position]));
    const projectPosition = new Map(projects.map((p) => [p.id, p.position]));
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    return [...filtered].sort((a, b) =>
      compareTasks(a, b, sort, { statusPosition, projectPosition, projectName }),
    );
  }, [pool, search, filterGroups, matchCtx, sort, statuses, projects]);

  const columns = useMemo(
    () => resolveColumns(columnsOrder, widths, fields),
    [columnsOrder, widths, fields],
  );

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const canEdit = useV2Store((s) => s.orgRole !== "guest" && s.orgRole !== null);

  const cellCtx = useMemo(
    () => ({
      statuses,
      tags,
      members,
      projectsById,
      canEdit,
      wrapTitle,
      onPatch: patchOne,
      onPlacements: setPlacements,
    }),
    [statuses, tags, members, projectsById, canEdit, wrapTitle, patchOne, setPlacements],
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

  /**
   * Массовое назначение перетирает исполнителей у всех выбранных строк, поэтому
   * годятся только те, кого пускают закрытые проекты каждой из них. Текущих
   * исполнителей здесь не сохраняем: это не правка списка, а замена.
   */
  const bulkAssignees = useMemo(
    () =>
      assigneeChoice(
        members,
        projects,
        [...new Set(selectedTasks.flatMap((t) => t.placements.map((p) => p.project_id)))],
      ),
    [members, projects, selectedTasks],
  );

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
    if (!onCreateTask || !quickTitle.trim()) return;
    try {
      await onCreateTask(emptyDraft({ ...draftDefaults, title: quickTitle.trim() }));
      setQuickTitle("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать задачу");
    }
  }

  const toggleSort = useCallback((column: string) => toggleSortRaw(column as SortColumn), [toggleSortRaw]);

  const shownError = externalError ?? error;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        {titleSlot}
        <TaskCount shown={visibleTasks.length} total={pool.length} />

        {/* На узком экране кнопки экрана держатся первой строки — получается
            обычная шапка приложения, а настройки уходят строкой ниже. */}
        {compact && (
          <>
            <span className="flex-1" />
            {actionsSlot}
          </>
        )}

        <TaskSearch compact={compact} />
        <FilterButton />

        {!compact && (
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
        )}

        <span className="flex-1" />

        {!compact && actionsSlot}
        {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        {/* Настройки — последними у правого края: открывают их редко, а место
            в начале шапки нужно поиску и фильтрам. */}
        <ViewSettingsPopover customFields={fields} />
      </header>

      {/* На телефоне строка со всеми колонками бессмысленна — там остаётся
          прежний ввод одного названия. */}
      {onCreateTask && canEdit && compact && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
          <Plus className="size-3.5 text-muted-foreground" />
          <input
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void quickAdd()}
            placeholder={quickAddPlaceholder}
            className="h-6 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}

      {shownError && (
        <div className="flex shrink-0 items-center gap-2 bg-destructive/10 px-4 py-1.5 text-sm text-destructive">
          <span className="flex-1">{shownError}</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setError(null);
              onDismissError?.();
            }}
          >
            Скрыть
          </Button>
        </div>
      )}
      {truncated && (
        <p className="shrink-0 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          Показаны первые 3000 задач — сузьте фильтр, чтобы увидеть остальные.
        </p>
      )}

      {/* Таблица рисуется всегда, даже пока грузится и пока пусто: в ней живёт
          строка добавления, и размонтировать её — значит потерять набранный
          черновик на ровном месте. */}
      <div className="min-h-0 flex-1">
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
          onOpen={onOpenTask}
          labelForGroup={labelForGroup}
          groupOrder={groupOrder}
          composer={
            // Гостю строка создания не нужна: сервер всё равно откажет.
            onCreateTask && canEdit && !compact ? (
              <TaskComposer columns={columns} defaults={draftDefaults} onCreate={onCreateTask} />
            ) : undefined
          }
          emptyState={
            // sticky left-0 — иначе при горизонтальной прокрутке подпись уезжает
            // вместе с колонками. w-max обязателен: блок во всю ширину таблицы
            // смещать некуда, и sticky на нём молча не работает.
            <p className="sticky left-0 w-max px-4 py-8 text-sm text-muted-foreground">
              {loading && tasks.length === 0
                ? "Загрузка…"
                : tasks.length === 0
                  ? emptyText
                  : pool.length === 0
                    ? // Все задачи ушли в «Готово»/«Архив» — иначе человек решит,
                      // что список сломался.
                      "Все задачи в «Готово» или «Архиве» — включите их показ в «Фильтрах», чтобы увидеть."
                    : `Ни одна задача не подходит под фильтр${search ? ` «${search}»` : ""}.`}
            </p>
          }
        />
      </div>

      {selected.size > 0 && canEdit && (
        <BulkBar
          count={selected.size}
          statuses={statuses}
          tags={tags}
          members={bulkAssignees.members}
          restrictedBy={bulkAssignees.restrictedBy}
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

      {/* Подпись группировки для скринридеров — визуально её несёт кнопка. */}
      <span className="sr-only">
        Группировка: {GROUP_BY_LABELS[groupBy[0]]}
        {groupBy[1] !== "none" && `, затем ${GROUP_BY_LABELS[groupBy[1]]}`}
      </span>
    </div>
  );
}
