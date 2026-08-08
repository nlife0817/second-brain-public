"use client";

// Проект на телефоне: список карточек в один столбец вместо таблицы с
// горизонтальной прокруткой. Фильтры, поиск, сортировка и группировка — общий
// ViewStore проекта, тот же, что у десктопной таблицы: настройки переезжают
// между устройствами сами.
//
// Канбана здесь нет и не было: перенос между статусами делается из карточки.
// Жеста «потянуть, чтобы обновить» тоже нет — список сам является областью
// прокрутки, и вложенный скроллер ломает жест; вместо него кнопка в шапке и
// автоматическое обновление при возврате в приложение.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowUp, ChevronLeft, Plus, RefreshCw, Search, Settings, SlidersHorizontal, X } from "lucide-react";
import { CreateTaskSheet, TaskSheet } from "@/components/v2/lazy";
import { GroupByButton, MobileTaskList } from "@/components/v2/mobile/MobileTaskList";
import { useAppResume, useBackDismiss, useTaskDeepLink } from "@/components/v2/mobile/hooks";
import { ProjectIcon } from "@/components/v2/project-icons";
import { FilterButton, TaskCount } from "@/components/v2/tasks/ViewToolbar";
import { cachedGet, invalidate, seed } from "@/lib/core/query";
import { useLoad } from "@/lib/core/use-load";
import { applyTaskChange } from "@/lib/core/task-change";
import { createTaskFromDraft, emptyDraft } from "@/lib/core/task-draft";
import type { Project, ProjectMemberWithUser, ProjectRole, TaskRow } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { ViewStoreProvider, projectScope, useViewStore } from "@/lib/core/view-store";
import { filterTasks, makeMatchContext, showsDone, visiblePool } from "@/lib/core/views";
import { cn } from "@/lib/utils";

export type ProjectDetail = Project & {
  my_role: ProjectRole | null;
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
  const search = useViewStore((s) => s.search);
  const setSearch = useViewStore((s) => s.setSearch);
  // Ссылка на задачу (/v2/tasks/<id>) приводит в проект с ?task=<id>; proxy
  // переносит параметр на мобильный адрес.
  const deepLinkTaskId = useSearchParams().get("task");

  const [project, setProject] = useState<ProjectDetail | null>(initialProject);
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [openTaskId, setOpenTaskId] = useState<string | null>(deepLinkTaskId);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Подстройка под сменившуюся ссылку — в рендере: эффект дал бы лишний проход
  // до отрисовки (см. то же в «Моих задачах»).
  const [seenDeepLink, setSeenDeepLink] = useState(deepLinkTaskId);
  if (deepLinkTaskId !== seenDeepLink) {
    setSeenDeepLink(deepLinkTaskId);
    if (deepLinkTaskId) setOpenTaskId(deepLinkTaskId);
  }

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

  useLoad(load);
  useAppResume(reload);

  const canEdit = project?.my_role === "admin" || project?.my_role === "editor";
  const openTask = useCallback((id: string) => setOpenTaskId(id), []);
  const closeTask = useCallback(() => setOpenTaskId(null), []);
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  useTaskDeepLink(setOpenTaskId);
  useBackDismiss(!!openTaskId, closeTask);
  useBackDismiss(createOpen, closeCreate);

  const onCreated = useCallback(() => {
    setQuickTitle("");
    void reload();
    void refreshProjects();
  }, [reload, refreshProjects]);

  async function quickAdd() {
    if (!orgId || !quickTitle.trim() || adding) return;
    setAdding(true);
    try {
      await createTaskFromDraft(
        orgId,
        emptyDraft({ project_ids: [projectId], title: quickTitle.trim() }),
      );
      onCreated();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать задачу");
    } finally {
      setAdding(false);
    }
  }

  if (error && !project) {
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
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border px-4 py-2">
        <div className="flex items-center gap-1">
          <Link
            href="/v2/m/projects"
            className="-ml-2 rounded-lg p-2 text-muted-foreground active:bg-muted"
            aria-label="Назад"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <ProjectIcon name={project.icon} color={project.color} className="size-4 shrink-0" />
          <h1 className="min-w-0 flex-1 truncate font-heading text-lg font-semibold tracking-tight">
            {project.name}
          </h1>
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
        </div>

        {/* Вторая строка: поиск разворачивается на всю ширину — постоянное поле
            съедало бы место у фильтров и группировки. */}
        <div className="flex items-center gap-1 pt-1">
          {searchOpen || search ? (
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию…"
                className="h-9 w-full rounded-lg border border-input bg-transparent pl-8 pr-8 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring"
              />
              <button
                onClick={() => {
                  setSearch("");
                  setSearchOpen(false);
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground"
                aria-label="Закрыть поиск"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => setSearchOpen(true)}
                className="rounded-lg p-2 text-muted-foreground active:bg-muted"
                aria-label="Поиск"
              >
                <Search className="size-4" />
              </button>
              <FilterButton />
              <GroupByButton />
              <span className="flex-1" />
              <TaskCountOfList tasks={tasks} />
            </>
          )}
        </div>
      </header>

      {canEdit && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <Plus className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void quickAdd()}
            enterKeyHint="done"
            placeholder="Быстро добавить задачу…"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          {/* Лист создания открывается с уже набранным названием: параметры —
              это продолжение того же ввода, а не отдельная форма. */}
          <button
            onClick={() => setCreateOpen(true)}
            aria-label="Задача с параметрами"
            className={cn(
              "-my-1 rounded-lg p-1.5 text-muted-foreground active:bg-muted",
              quickTitle.trim() && "text-primary",
            )}
          >
            <SlidersHorizontal className="size-4" />
          </button>
          {quickTitle.trim() && (
            <button
              onClick={() => void quickAdd()}
              disabled={adding}
              aria-label="Добавить задачу"
              className="-my-1 rounded-lg bg-primary p-1.5 text-primary-foreground disabled:opacity-50"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="min-w-0 flex-1">{error}</span>
          <button onClick={() => void reload()} className="shrink-0 font-medium underline">
            Повторить
          </button>
        </div>
      )}

      <MobileTaskList tasks={tasks} onOpenTask={openTask} emptyText="В проекте пока нет задач." />

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
      <CreateTaskSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaults={{ project_ids: [projectId] }}
        initialTitle={quickTitle}
        onCreated={onCreated}
      />
    </div>
  );
}

/** «12 из 40» по тем же правилам отсева, что и сам список. */
function TaskCountOfList({ tasks }: { tasks: TaskRow[] }) {
  const { statuses, me } = useV2Store();
  const filterGroups = useViewStore((s) => s.groups);
  const search = useViewStore((s) => s.search);
  // Лёгкий пересчёт на рендер: список короче потолка выборки, мемо тут лишнее.
  const pool = visiblePool(tasks, filterGroups, statuses);
  const shown = filterTasks(pool, filterGroups, search, makeMatchContext(me?.id ?? null)).length;
  return <TaskCount shown={shown} total={pool.length} />;
}
