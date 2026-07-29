"use client";

// Экран проекта. Задачи показываются двумя видами:
//  - таблица — тот же `TaskTableView`, что и «Все задачи»: колонки, фильтры,
//    группировка, правка прямо в строке и массовые действия;
//  - доска — канбан по статусам с перетаскиванием.
// Вид запоминается вместе с остальными настройками представления, и настройки
// эти у каждого проекта свои: набор колонок внутри проекта — другой рабочий
// срез, чем «всё сразу».
//
// Проект и его задачи считает сервер (`initial`) — экран рисуется сразу, без
// пары запросов после гидрации. Дальше список живёт в клиентском кэше.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { KanbanSquare, Plus, Settings, Table2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AvatarStack } from "@/components/v2/bits";
import { CardSettingsPopover } from "@/components/v2/CardSettings";
import { CreateTaskDialog, ProjectMembersDialog, TaskSheet } from "@/components/v2/lazy";
import { accessLabel } from "@/components/v2/ProjectAccessPicker";
import { ProjectIcon } from "@/components/v2/project-icons";
import { TaskTableView } from "@/components/v2/tasks/TaskTableView";
import { cachedGet, invalidate, seed } from "@/lib/core/query";
import { applyTaskChange } from "@/lib/core/task-change";
import { createTaskFromDraft, type TaskDraft } from "@/lib/core/task-draft";
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
import { cn } from "@/lib/utils";
import { ProjectBoard } from "./ProjectBoard";

export type ProjectDetail = Project & {
  my_role: ProjectRole | null;
  sections: Section[];
  members: ProjectMemberWithUser[];
};

export function ProjectBoardClient(props: {
  projectId: string;
  initialProject: ProjectDetail;
  initialTasks: TaskRow[];
}) {
  return (
    <ViewStoreProvider scope={projectScope(props.projectId)}>
      <ProjectScreen {...props} />
    </ViewStoreProvider>
  );
}

/** Переключатель вида — единственное место, где экран проекта расходится. */
function ViewSwitch() {
  const mode = useViewStore((s) => s.mode);
  const setMode = useViewStore((s) => s.setMode);
  const item = "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium";
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      <button
        onClick={() => setMode("table")}
        className={cn(item, mode === "table" ? "bg-background shadow-sm" : "text-muted-foreground")}
        title="Таблица"
      >
        <Table2 className="size-3.5" />
        <span className="hidden xl:inline">Таблица</span>
      </button>
      <button
        onClick={() => setMode("board")}
        className={cn(item, mode === "board" ? "bg-background shadow-sm" : "text-muted-foreground")}
        title="Доска"
      >
        <KanbanSquare className="size-3.5" />
        <span className="hidden xl:inline">Доска</span>
      </button>
    </div>
  );
}

function ProjectScreen({
  projectId,
  initialProject,
  initialTasks,
}: {
  projectId: string;
  initialProject: ProjectDetail;
  initialTasks: TaskRow[];
}) {
  const { orgId, statuses, metaLoading, refreshProjects } = useV2Store();
  const mode = useViewStore((s) => s.mode);
  // Завершённые тянем с сервера только когда их просят показать: условие
  // «Готово = Показать» в «Фильтрах» — единственный переключатель, общий у
  // таблицы, доски и сводного списка.
  const withDone = showsDone(useViewStore((s) => s.groups));

  const [project, setProject] = useState<ProjectDetail | null>(initialProject);
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [createIn, setCreateIn] = useState<string | null | false>(false); // false = закрыт, null/statusId = открыт
  const [membersOpen, setMembersOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Отдельно от `error`: тот означает «экран показать нечем» и подменяет собой
  // всю страницу. Замечание по только что созданной задаче — полоса над списком.
  const [notice, setNotice] = useState<string | null>(null);

  const projectPath = orgId ? `/orgs/${orgId}/projects/${projectId}` : null;
  const tasksPath = projectPath ? `${projectPath}/tasks${withDone ? "?done=1" : ""}` : null;

  // Серверные данные — в кэш: переход на соседний экран и назад обойдётся без
  // повторной пары запросов.
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

  const canEdit = project?.my_role === "admin" || project?.my_role === "editor";

  // Стабильная ссылка: инлайновая стрелка сводила бы memo карточек на нет.
  const openTask = useCallback((id: string) => setOpenTaskId(id), []);
  const addTask = useCallback((statusId: string | null) => setCreateIn(statusId), []);

  // Задача создаётся сразу в этом проекте: строка, добавленная с экрана проекта
  // и уехавшая в личный инбокс, тут же пропала бы из списка. Стабильная ссылка —
  // иначе черновик сбрасывался бы на каждый ре-рендер экрана.
  const draftDefaults = useMemo(() => ({ project_ids: [projectId] }), [projectId]);

  const createTask = useCallback(
    async (draft: TaskDraft) => {
      if (!orgId) return;
      // Проект уже лежит в черновике, но подстраховываемся: задача без
      // размещения уедет в личный инбокс и пропадёт из этого списка.
      const { fieldsWarning } = await createTaskFromDraft(
        orgId,
        draft,
        draft.project_ids.length === 0 ? { placements: [{ project_id: projectId }] } : undefined,
      );
      setNotice(fieldsWarning);
      await reload();
      await refreshProjects();
    },
    [orgId, projectId, reload, refreshProjects],
  );

  if (error) {
    return <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div>;
  }
  // Ждём и статусы: без них раскладка свалила бы все задачи в «Без статуса».
  if (!project || (statuses.length === 0 && metaLoading)) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Загрузка…</div>;
  }

  const title = (
    <>
      <ProjectIcon name={project.icon} color={project.color} className="size-4" />
      <h1 className="font-heading text-xl font-semibold tracking-tight">{project.name}</h1>
      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
        {accessLabel(project.default_role)}
      </span>
    </>
  );

  const membersButton = (
    <button
      onClick={() => setMembersOpen(true)}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-muted"
      title="Участники проекта"
    >
      <AvatarStack
        users={project.members.map((m) => ({ id: m.user_id, email: m.email, name: m.name, avatar_url: m.avatar_url }))}
      />
      <Users className="size-4 text-muted-foreground" />
    </button>
  );

  const settingsLink = canEdit && (
    <Link
      href={`/v2/projects/${projectId}/settings`}
      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      title="Настройки проекта"
    >
      <Settings className="size-4" />
    </Link>
  );

  const addButton = canEdit && (
    <Button size="sm" onClick={() => setCreateIn(null)}>
      <Plus className="size-4" />
      Задача
    </Button>
  );

  const layers = (
    <>
      <TaskSheet
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        onChanged={(change) => {
          // Перечитывать экран (сотни строк) на каждую правку поля незачем —
          // новое состояние строки пришло вместе с ответом.
          if (change.type === "reload") {
            void reload();
            void refreshProjects();
            return;
          }
          setTasks((prev) => applyTaskChange(prev, change) ?? prev);
          if (change.type === "deleted" || change.confirmed) {
            // Локально экран верен, но в кэше лежит расклад до правки.
            if (projectPath) invalidate(projectPath);
            void refreshProjects();
          }
        }}
      />
      <CreateTaskDialog
        open={createIn !== false}
        onOpenChange={(open) => !open && setCreateIn(false)}
        projectId={projectId}
        statusId={createIn === false ? null : createIn}
        onCreated={() => {
          void reload();
          void refreshProjects();
        }}
      />
      <ProjectMembersDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        project={project}
        onChanged={() => void reload()}
        settingsHref={`/v2/projects/${projectId}/settings`}
      />
    </>
  );

  if (mode === "table") {
    return (
      <>
        <TaskTableView
          tasks={tasks}
          setTasks={setTasks}
          reload={reload}
          invalidateKey={projectPath}
          onOpenTask={openTask}
          onCreateTask={canEdit ? createTask : undefined}
          draftDefaults={draftDefaults}
          error={notice}
          onDismissError={() => setNotice(null)}
          quickAddPlaceholder={`Быстро добавить задачу в «${project.name}»…`}
          emptyText="В проекте пока нет задач."
          titleSlot={title}
          actionsSlot={
            <>
              <ViewSwitch />
              {membersButton}
              {settingsLink}
              {addButton}
            </>
          }
        />
        {layers}
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        {title}
        <span className="flex-1" />
        <ViewSwitch />
        <CardSettingsPopover />
        {membersButton}
        {settingsLink}
        {addButton}
      </header>

      <ProjectBoard
        projectId={projectId}
        projectPath={projectPath}
        tasks={tasks}
        setTasks={setTasks}
        canEdit={!!canEdit}
        onOpenTask={openTask}
        onAddTask={addTask}
      />

      {layers}
    </div>
  );
}
