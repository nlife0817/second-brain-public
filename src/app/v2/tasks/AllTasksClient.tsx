"use client";

// «Все задачи» — сводный список по всем доступным проектам сразу.
// Данные тянутся один раз на открытие экрана; фильтрация, сортировка и
// группировка идут на клиенте, поэтому реакция на любую настройку мгновенная,
// а счётчики групп остаются честными (при серверной пагинации они бы врали).
//
// Список считает сервер и отдаёт в `initial`: экран показывает незавершённые
// задачи неархивных проектов — то есть ровно то, ради чего его открывают.
// Задачи в «Готово» и «Архиве» скрыты, пока их не включат условиями
// «Готово/Архив = Показать»; всё остальное сужение — тоже через «Фильтры».
//
// Сама таблица со всей обвязкой — общий `TaskTableView`: тот же экран рисуется
// внутри проекта, и расходиться они не должны.

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TaskSheet } from "@/components/v2/lazy";
import { CalendarView } from "@/components/v2/tasks/CalendarView";
import { GanttView } from "@/components/v2/tasks/GanttView";
import { TaskTableView } from "@/components/v2/tasks/TaskTableView";
import { ViewModeSwitch } from "@/components/v2/tasks/ViewToolbar";
import { cachedGet, invalidate, peek, seed } from "@/lib/core/query";
import { useLoad } from "@/lib/core/use-load";
import { applyTaskChange } from "@/lib/core/task-change";
import { createTaskFromDraft, type TaskDraft } from "@/lib/core/task-draft";
import type { AllTasksResult, TaskRow } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { ViewStoreProvider, useViewStore } from "@/lib/core/view-store";
import { showsDone } from "@/lib/core/views";

export function AllTasksClient({ initial }: { initial: AllTasksResult }) {
  return (
    <ViewStoreProvider scope="all">
      <AllTasksScreen initial={initial} />
    </ViewStoreProvider>
  );
}

function AllTasksScreen({ initial }: { initial: AllTasksResult }) {
  const { orgId, refreshProjects } = useV2Store();
  // Пуш и поиск умеют вести прямо на задачу.
  const deepLinkTaskId = useSearchParams().get("task");
  const filterGroups = useViewStore((s) => s.groups);
  const mode = useViewStore((s) => s.mode);

  const [tasks, setTasks] = useState<TaskRow[]>(initial.tasks);
  const [truncated, setTruncated] = useState(initial.truncated);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(deepLinkTaskId);

  // Завершённых сервер по умолчанию не отдаёт — просим их только по условию
  // «Готово = Показать». Иначе оно показало бы пустоту, а грузить весь архив
  // завершённого на каждое открытие экрана незачем.
  const wantsDone = showsDone(filterGroups);

  const basePath = orgId ? `/orgs/${orgId}/tasks?view=all` : null;
  const path = basePath ? `${basePath}${wantsDone ? "&done=1" : ""}` : null;

  // Серверные данные — в кэш: возврат на экран в ближайшие секунды обойдётся
  // без запроса, а первый эффект загрузки ниже увидит их уже свежими. Ключ —
  // всегда базовый: сервер считал список без завершённых.
  useEffect(() => {
    if (basePath) seed(basePath, initial);
  }, [basePath, initial]);

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
    if (orgId) invalidate(`/orgs/${orgId}/tasks`);
    await load({ force: true });
  }, [orgId, load]);

  useLoad(load);

  // Ссылка из пуша или поиска открывает карточку сразу, на первом же рендере, и
  // ещё раз, если ссылка сменилась при уже смонтированном экране. Правка
  // состояния во время рендера — задокументированный React способ подстроиться
  // под изменившийся вход; эффект здесь означал бы лишний проход рендера до
  // отрисовки.
  const [seenDeepLink, setSeenDeepLink] = useState(deepLinkTaskId);
  if (deepLinkTaskId !== seenDeepLink) {
    setSeenDeepLink(deepLinkTaskId);
    if (deepLinkTaskId) setOpenTaskId(deepLinkTaskId);
  }

  const createTask = useCallback(
    async (draft: TaskDraft) => {
      if (!orgId) return;
      const { fieldsWarning } = await createTaskFromDraft(orgId, draft);
      setError(fieldsWarning);
      await reload();
      await refreshProjects();
    },
    [orgId, reload, refreshProjects],
  );

  const title = <h1 className="font-heading text-xl font-semibold tracking-tight">Все задачи</h1>;
  // Доски здесь нет: раскладка по статусам поверх всех проектов организации —
  // это не доска, а свалка. Остальные виды показывают один и тот же срез.
  const viewSwitch = <ViewModeSwitch modes={["table", "gantt", "calendar"]} />;

  return (
    <>
      {mode === "calendar" ? (
        <CalendarView
          tasks={tasks}
          setTasks={setTasks}
          reload={reload}
          invalidateKey={orgId ? `/orgs/${orgId}/tasks` : null}
          loading={loading}
          error={error}
          onDismissError={() => setError(null)}
          onOpenTask={setOpenTaskId}
          onCreateTask={createTask}
          titleSlot={title}
          actionsSlot={viewSwitch}
        />
      ) : mode === "gantt" ? (
        <GanttView
          tasks={tasks}
          setTasks={setTasks}
          reload={reload}
          invalidateKey={orgId ? `/orgs/${orgId}/tasks` : null}
          loading={loading}
          error={error}
          onDismissError={() => setError(null)}
          onOpenTask={setOpenTaskId}
          titleSlot={title}
          actionsSlot={viewSwitch}
        />
      ) : (
        <TaskTableView
          tasks={tasks}
          setTasks={setTasks}
          reload={reload}
          invalidateKey={orgId ? `/orgs/${orgId}/tasks` : null}
          loading={loading}
          truncated={truncated}
          error={error}
          onDismissError={() => setError(null)}
          onOpenTask={setOpenTaskId}
          onCreateTask={createTask}
          titleSlot={title}
          actionsSlot={viewSwitch}
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
    </>
  );
}
