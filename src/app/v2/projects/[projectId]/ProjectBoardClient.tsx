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
import { useSearchParams } from "next/navigation";
import { KanbanSquare, Plus, Settings, Table2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AvatarStack } from "@/components/v2/bits";
import { CardSettingsPopover } from "@/components/v2/CardSettings";
import { CreateTaskDialog, ProjectMembersDialog, TaskSheet } from "@/components/v2/lazy";
import { accessLabel } from "@/components/v2/ProjectAccessPicker";
import { ProjectIcon } from "@/components/v2/project-icons";
import { TaskTableView } from "@/components/v2/tasks/TaskTableView";
import { BOARD_SECTIONS, ViewSettingsPopover } from "@/components/v2/tasks/ViewControls";
import { FilterButton, TaskCount, TaskSearch } from "@/components/v2/tasks/ViewToolbar";
import { cachedGet, invalidate, seed } from "@/lib/core/query";
import { useLoad } from "@/lib/core/use-load";
import { applyTaskChange } from "@/lib/core/task-change";
import { createTaskFromDraft, type TaskDraft } from "@/lib/core/task-draft";
import type { Project, ProjectMemberWithUser, ProjectRole, TaskRow } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { ViewStoreProvider, projectScope, useViewStore } from "@/lib/core/view-store";
import { filterTasks, makeMatchContext, showsDone, visiblePool } from "@/lib/core/views";
import { cn } from "@/lib/utils";
import { ProjectBoard } from "./ProjectBoard";

export type ProjectDetail = Project & {
  my_role: ProjectRole | null;
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
  const { orgId, statuses, fields, me, metaLoading, refreshProjects } = useV2Store();
  const mode = useViewStore((s) => s.mode);
  const filterGroups = useViewStore((s) => s.groups);
  const search = useViewStore((s) => s.search);
  // Завершённые тянем с сервера только когда их просят показать: условие
  // «Готово = Показать» в «Фильтрах» — единственный переключатель, общий у
  // таблицы, доски и сводного списка.
  const withDone = showsDone(filterGroups);
  // Ссылка вида /v2/tasks/<id> приводит сюда с ?task=<id> — карточку открываем
  // сразу, как это делают «Мои задачи» для ссылок из push-уведомлений.
  const deepLinkTaskId = useSearchParams().get("task");

  const [project, setProject] = useState<ProjectDetail | null>(initialProject);
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [openTaskId, setOpenTaskId] = useState<string | null>(deepLinkTaskId);
  const [createIn, setCreateIn] = useState<string | null | false>(false); // false = закрыт, null/statusId = открыт
  const [membersOpen, setMembersOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Отдельно от `error`: тот означает «экран показать нечем» и подменяет собой
  // всю страницу. Замечание по только что созданной задаче — полоса над списком.
  const [notice, setNotice] = useState<string | null>(null);

  const projectPath = orgId ? `/orgs/${orgId}/projects/${projectId}` : null;
  const tasksPath = projectPath ? `${projectPath}/tasks${withDone ? "?done=1" : ""}` : null;

  // Ссылка сменилась при уже открытом экране (переход по другой ссылке на
  // задачу) — открываем новую. Правка состояния в рендере, а не в эффекте: см.
  // тот же приём в «Моих задачах».
  const [seenDeepLink, setSeenDeepLink] = useState(deepLinkTaskId);
  if (deepLinkTaskId !== seenDeepLink) {
    setSeenDeepLink(deepLinkTaskId);
    if (deepLinkTaskId) setOpenTaskId(deepLinkTaskId);
  }

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

  useLoad(load);

  const canEdit = project?.my_role === "admin" || project?.my_role === "editor";

  // Стабильная ссылка: инлайновая стрелка сводила бы memo карточек на нет.
  const openTask = useCallback((id: string) => setOpenTaskId(id), []);
  const addTask = useCallback((statusId: string | null) => setCreateIn(statusId), []);

  // Задача создаётся сразу в этом проекте: строка, добавленная с экрана проекта
  // и уехавшая в личный инбокс, тут же пропала бы из списка. Стабильная ссылка —
  // иначе черновик сбрасывался бы на каждый ре-рендер экрана.
  const draftDefaults = useMemo(() => ({ project_ids: [projectId] }), [projectId]);

  // Счётчик доски считает ровно то, что доска показывает: раскладка по колонкам
  // отсеивает задачи теми же функциями. Таблица считает его у себя — там в
  // знаменателе тот же пул до фильтра.
  const matchCtx = useMemo(() => makeMatchContext(me?.id ?? null), [me?.id]);
  const boardPool = useMemo(
    () => visiblePool(tasks, filterGroups, statuses),
    [tasks, filterGroups, statuses],
  );
  const boardShown = useMemo(
    () => filterTasks(boardPool, filterGroups, search, matchCtx).length,
    [boardPool, filterGroups, search, matchCtx],
  );

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
      {/* Шапка доски повторяет шапку таблицы: те же поиск, фильтры и счётчик,
          потому что настройки у обоих видов общие. Отличие одно — в настройках
          представления доске отданы только применимые разделы. */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        {title}
        <TaskCount shown={boardShown} total={boardPool.length} />
        <TaskSearch />
        <FilterButton />
        <span className="flex-1" />
        <ViewSwitch />
        <CardSettingsPopover />
        {membersButton}
        {settingsLink}
        {addButton}
        <ViewSettingsPopover customFields={fields} sections={BOARD_SECTIONS} />
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
