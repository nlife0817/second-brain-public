"use client";

// Проект на мобильном: вместо канбана — список задач, сгруппированный по
// статусам, с фильтром-чипсами. Перенос между статусами — из карточки задачи.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import { CreateTaskDialog, TaskSheet } from "@/components/v2/lazy";
import { TaskCard } from "@/components/v2/TaskCard";
import { PullToRefresh } from "@/components/v2/mobile/PullToRefresh";
import { useAppResume, useBackDismiss, useTaskDeepLink } from "@/components/v2/mobile/hooks";
import { cachedGet, invalidate, seed } from "@/lib/core/query";
import type {
  Project,
  ProjectMemberWithUser,
  ProjectRole,
  Section,
  TaskListItem,
} from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

export type ProjectDetail = Project & {
  my_role: ProjectRole | null;
  sections: Section[];
  members: ProjectMemberWithUser[];
};

/** Сколько карточек секция показывает сразу (см. CardList на десктопной доске). */
const SECTION_PAGE = 50;

function SectionList({
  tasks,
  onOpenTask,
}: {
  tasks: TaskListItem[];
  onOpenTask: (id: string) => void;
}) {
  const [limit, setLimit] = useState(SECTION_PAGE);
  const shown = tasks.length > limit ? tasks.slice(0, limit) : tasks;
  const rest = tasks.length - shown.length;
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((t) => (
        <TaskCard key={t.id} task={t} onOpen={onOpenTask} />
      ))}
      {rest > 0 && (
        <button
          onClick={() => setLimit((l) => l + SECTION_PAGE)}
          className="rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground"
        >
          Показать ещё {Math.min(SECTION_PAGE, rest)} · осталось {rest}
        </button>
      )}
    </div>
  );
}

export function MobileProjectClient({
  projectId,
  initialProject,
  initialTasks,
}: {
  projectId: string;
  initialProject: ProjectDetail;
  initialTasks: TaskListItem[];
}) {
  const { orgId, statuses, metaLoading, refreshProjects } = useV2Store();
  const [project, setProject] = useState<ProjectDetail | null>(initialProject);
  const [tasks, setTasks] = useState<TaskListItem[]>(initialTasks);
  // Фильтр: null — все открытые статусы; id статуса — только он.
  // Задачи «Готово»/архива подгружаются, когда выбран соответствующий чип.
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needDone = useMemo(() => {
    if (!statusFilter) return false;
    const s = statuses.find((x) => x.id === statusFilter);
    return !!s && s.kind !== "open";
  }, [statusFilter, statuses]);

  const projectPath = orgId ? `/orgs/${orgId}/projects/${projectId}` : null;
  const tasksPath = projectPath ? `${projectPath}/tasks${needDone ? "?done=1" : ""}` : null;

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
          cachedGet<TaskListItem[]>(tasksPath, opts),
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

  // Один проход по задачам, как на десктопной доске.
  const byStatus = useMemo(() => {
    const map = new Map<string, TaskListItem[]>();
    const noStatus: TaskListItem[] = [];
    for (const t of tasks) {
      if (t.status_id) {
        const bucket = map.get(t.status_id);
        if (bucket) bucket.push(t);
        else map.set(t.status_id, [t]);
      } else {
        noStatus.push(t);
      }
    }
    return { map, noStatus };
  }, [tasks]);

  const sections = useMemo(() => {
    if (statusFilter) {
      const status = statuses.find((s) => s.id === statusFilter);
      if (!status) return [];
      return [{ status, tasks: byStatus.map.get(status.id) ?? [] }];
    }
    return statuses
      .filter((s) => s.kind === "open")
      .map((s) => ({ status: s, tasks: byStatus.map.get(s.id) ?? [] }))
      .filter((s) => s.tasks.length > 0);
  }, [statusFilter, statuses, byStatus]);

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
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-1.5 border-b border-border py-2 pl-1 pr-3">
        <Link href="/v2/m/projects" className="rounded-lg p-2 text-muted-foreground active:bg-muted" aria-label="Назад">
          <ChevronLeft className="size-5" />
        </Link>
        <span className="size-3 shrink-0 rounded" style={{ backgroundColor: project.color }} />
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{project.name}</h1>
        {canEdit && (
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded-lg p-2 text-muted-foreground active:bg-muted"
            aria-label="Новая задача"
          >
            <Plus className="size-5" />
          </button>
        )}
      </header>

      <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border px-3 py-2 [-webkit-overflow-scrolling:touch]">
        <button
          onClick={() => setStatusFilter(null)}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1 text-xs font-medium",
            !statusFilter ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground",
          )}
        >
          Активные
        </button>
        {statuses.map((s) => (
          <button
            key={s.id}
            onClick={() => setStatusFilter((cur) => (cur === s.id ? null : s.id))}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
              statusFilter === s.id
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground",
            )}
          >
            <span className="size-1.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.name}
          </button>
        ))}
      </div>

      <PullToRefresh onRefresh={reload} className="px-4 py-3">
        <div className="flex flex-col gap-4">
          {sections.map(({ status, tasks: sectionTasks }) => (
            <section key={status.id}>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span className="size-2 rounded-full" style={{ backgroundColor: status.color }} />
                {status.name} · {sectionTasks.length}
              </h2>
              <SectionList tasks={sectionTasks} onOpenTask={openTask} />
            </section>
          ))}
          {!statusFilter && byStatus.noStatus.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Без статуса · {byStatus.noStatus.length}
              </h2>
              <SectionList tasks={byStatus.noStatus} onOpenTask={openTask} />
            </section>
          )}
          {sections.every((s) => s.tasks.length === 0) && byStatus.noStatus.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {statusFilter ? "В этом статусе задач нет" : "Открытых задач нет"}
            </p>
          )}
        </div>
      </PullToRefresh>

      <TaskSheet
        taskId={openTaskId}
        onClose={closeTask}
        onChanged={() => {
          void reload();
          void refreshProjects();
        }}
      />
      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        statusId={statusFilter}
        onCreated={() => {
          void reload();
          void refreshProjects();
        }}
      />
    </div>
  );
}
