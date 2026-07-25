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
//
// Сама таблица со всей обвязкой — общий `TaskTableView`: тот же экран рисуется
// внутри проекта, и расходиться они не должны.

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TaskSheet } from "@/components/v2/lazy";
import { TaskTableView } from "@/components/v2/tasks/TaskTableView";
import { api } from "@/lib/core/client";
import { cachedGet, invalidate, peek, seed } from "@/lib/core/query";
import { applyTaskChange } from "@/lib/core/task-change";
import type { AllTasksResult, TaskRow } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { ViewStoreProvider, useViewStore } from "@/lib/core/view-store";

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

  const showDone = useViewStore((s) => s.showDone);
  const showArchivedProjects = useViewStore((s) => s.showArchivedProjects);
  const setShowDone = useViewStore((s) => s.setShowDone);
  const setShowArchivedProjects = useViewStore((s) => s.setShowArchivedProjects);

  const [tasks, setTasks] = useState<TaskRow[]>(initial.tasks);
  const [truncated, setTruncated] = useState(initial.truncated);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

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

  const quickAdd = useCallback(
    async (title: string) => {
      if (!orgId) return;
      await api.post(`/orgs/${orgId}/tasks`, { title });
      await reload();
    },
    [orgId, reload],
  );

  return (
    <>
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
        onQuickAdd={quickAdd}
        quickAddPlaceholder="Быстро добавить задачу в личный инбокс…"
        titleSlot={<h1 className="text-base font-semibold">Все задачи</h1>}
        actionsSlot={
          <>
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
          </>
        }
      />

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
