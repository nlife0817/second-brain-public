"use client";

// Проект на телефоне — та же таблица, что и на большом экране: колонки,
// фильтры и группировка у проекта общие, и переключаться между устройствами,
// каждый раз перенастраивая список, незачем. Таблица прокручивается вбок,
// шапка ужата (`compact`).
//
// Канбана здесь нет и не было: перенос между статусами делается из карточки.
// Жеста «потянуть, чтобы обновить» тоже нет — таблица сама является областью
// прокрутки, и вложенный скроллер ломает жест; вместо него кнопка в шапке и
// автоматическое обновление при возврате в приложение.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Plus, RefreshCw, Settings } from "lucide-react";
import { CreateTaskDialog, TaskSheet } from "@/components/v2/lazy";
import { useAppResume, useBackDismiss, useTaskDeepLink } from "@/components/v2/mobile/hooks";
import { ProjectIcon } from "@/components/v2/project-icons";
import { TaskTableView } from "@/components/v2/tasks/TaskTableView";
import { cachedGet, invalidate, seed } from "@/lib/core/query";
import { applyTaskChange } from "@/lib/core/task-change";
import type {
  Project,
  ProjectMemberWithUser,
  ProjectRole,
  Section,
  TaskRow,
} from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { ViewStoreProvider, projectScope, useViewStore } from "@/lib/core/view-store";
import { showsDone } from "@/lib/core/views";

export type ProjectDetail = Project & {
  my_role: ProjectRole | null;
  sections: Section[];
  members: ProjectMemberWithUser[];
};

export function MobileProjectClient(props: {
  projectId: string;
  initialProject: ProjectDetail;
  initialTasks: TaskRow[];
}) {
  return (
    <ViewStoreProvider scope={projectScope(props.projectId)}>
      <MobileProjectScreen {...props} />
    </ViewStoreProvider>
  );
}

function MobileProjectScreen({
  projectId,
  initialProject,
  initialTasks,
}: {
  projectId: string;
  initialProject: ProjectDetail;
  initialTasks: TaskRow[];
}) {
  const { orgId, statuses, metaLoading, refreshProjects } = useV2Store();
  // Завершённые приходят только по условию «Готово = Показать» в «Фильтрах».
  const withDone = showsDone(useViewStore((s) => s.groups));

  const [project, setProject] = useState<ProjectDetail | null>(initialProject);
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectPath = orgId ? `/orgs/${orgId}/projects/${projectId}` : null;
  const tasksPath = projectPath ? `${projectPath}/tasks${withDone ? "?done=1" : ""}` : null;

  useEffect(() => {
    if (!projectPath) return;
    seed(projectPath, initialProject);
    seed(`${projectPath}/tasks`, initialTasks);
  }, [projectPath, initialProject, initialTasks]);

  const load = useCallback(
    async (opts: { force?: boolean } = {}) => {
      if (!projectPath || !tasksPath) return;
      try {
        const [p, ts] = await Promise.all([
          cachedGet<ProjectDetail>(projectPath, opts),
          cachedGet<TaskRow[]>(tasksPath, opts),
        ]);
        setProject(p);
        setTasks(ts);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Проект недоступен");
      }
    },
    [projectPath, tasksPath],
  );

  const reload = useCallback(async () => {
    if (projectPath) invalidate(projectPath);
    await load({ force: true });
  }, [projectPath, load]);

  useEffect(() => {
    void load();
  }, [load]);
  useAppResume(reload);

  const canEdit = project?.my_role === "admin" || project?.my_role === "editor";
  const openTask = useCallback((id: string) => setOpenTaskId(id), []);
  const closeTask = useCallback(() => setOpenTaskId(null), []);
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  useTaskDeepLink(setOpenTaskId);
  useBackDismiss(!!openTaskId, closeTask);
  useBackDismiss(createOpen, closeCreate);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <div className="flex items-center gap-3">
          <button onClick={() => void reload()} className="text-sm font-medium text-primary underline">
            Повторить
          </button>
          <Link href="/v2/m/projects" className="text-sm text-muted-foreground underline">
            К списку проектов
          </Link>
        </div>
      </div>
    );
  }
  if (!project || (statuses.length === 0 && metaLoading)) {
    return (
      <div className="flex h-full flex-col gap-2 px-4 py-3" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <>
      <TaskTableView
        compact
        tasks={tasks}
        setTasks={setTasks}
        reload={reload}
        invalidateKey={projectPath}
        onOpenTask={openTask}
        emptyText="В проекте пока нет задач."
        titleSlot={
          <>
            <Link
              href="/v2/m/projects"
              className="-ml-2 rounded-lg p-2 text-muted-foreground active:bg-muted"
              aria-label="Назад"
            >
              <ChevronLeft className="size-5" />
            </Link>
            <ProjectIcon name={project.icon} color={project.color} className="size-4 shrink-0" />
            <h1 className="max-w-[40vw] truncate font-heading text-lg font-semibold tracking-tight">{project.name}</h1>
          </>
        }
        actionsSlot={
          <>
            <button
              onClick={() => void reload()}
              className="rounded-lg p-2 text-muted-foreground active:bg-muted"
              aria-label="Обновить"
            >
              <RefreshCw className="size-4" />
            </button>
            {canEdit && (
              <Link
                href={`/v2/m/projects/${projectId}/settings`}
                className="rounded-lg p-2 text-muted-foreground active:bg-muted"
                aria-label="Настройки проекта"
              >
                <Settings className="size-5" />
              </Link>
            )}
            {canEdit && (
              <button
                onClick={() => setCreateOpen(true)}
                className="rounded-lg p-2 text-muted-foreground active:bg-muted"
                aria-label="Новая задача"
              >
                <Plus className="size-5" />
              </button>
            )}
          </>
        }
      />

      <TaskSheet
        taskId={openTaskId}
        onClose={closeTask}
        onChanged={(change) => {
          if (change.type === "reload") {
            void reload();
            void refreshProjects();
            return;
          }
          setTasks((prev) => applyTaskChange(prev, change) ?? prev);
          if (change.type === "deleted" || change.confirmed) {
            if (projectPath) invalidate(projectPath);
            void refreshProjects();
          }
        }}
      />
      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        statusId={null}
        onCreated={() => {
          void reload();
          void refreshProjects();
        }}
      />
    </>
  );
}
