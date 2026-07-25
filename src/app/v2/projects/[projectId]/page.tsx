"use client";

// Доска проекта: канбан по статусам, drag&drop карточек между колонками.

import { memo, use, useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateTaskDialog } from "@/components/v2/CreateTaskDialog";
import { ProjectMembersDialog } from "@/components/v2/ProjectMembersDialog";
import { TaskCard } from "@/components/v2/TaskCard";
import { TaskSheet } from "@/components/v2/TaskSheet";
import { api } from "@/lib/core/client";
import type {
  Project,
  ProjectMemberWithUser,
  ProjectRole,
  Section,
  TaskDetail,
  TaskStatus,
  TaskListItem,
} from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { AvatarStack } from "@/components/v2/bits";

/** Общая пустая колонка: новый [] на каждый рендер ломал бы memo карточек. */
const EMPTY_TASKS: TaskListItem[] = [];

type ProjectDetail = Project & {
  my_role: ProjectRole | null;
  sections: Section[];
  members: ProjectMemberWithUser[];
};

/**
 * Сколько карточек колонка отрисовывает сразу. В проекте бывают сотни задач, а
 * каждая карточка на доске — ещё и draggable: без предела dnd-kit регистрирует
 * их все и пересчитывает на каждое движение мыши.
 */
const COLUMN_PAGE = 50;

function Column({
  status,
  tasks,
  canEdit,
  onOpenTask,
  onAdd,
}: {
  status: TaskStatus;
  tasks: TaskListItem[];
  canEdit: boolean;
  onOpenTask: (id: string) => void;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `status:${status.id}` });
  const [limit, setLimit] = useState(COLUMN_PAGE);
  const shown = tasks.length > limit ? tasks.slice(0, limit) : tasks;
  const rest = tasks.length - shown.length;
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/40">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <span className="size-2 rounded-full" style={{ backgroundColor: status.color }} />
        <span className="text-sm font-medium">{status.name}</span>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
        <span className="flex-1" />
        {canEdit && (
          <button onClick={onAdd} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={`flex min-h-24 flex-1 flex-col gap-1.5 overflow-y-auto p-2 transition-colors ${isOver ? "bg-muted/70" : ""}`}
      >
        {shown.map((t) => (
          <DraggableCard key={t.id} task={t} disabled={!canEdit} onOpen={onOpenTask} />
        ))}
        {rest > 0 && (
          <button
            onClick={() => setLimit((l) => l + COLUMN_PAGE)}
            className="rounded-lg border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            Показать ещё {Math.min(COLUMN_PAGE, rest)} · осталось {rest}
          </button>
        )}
      </div>
    </div>
  );
}

const DraggableCard = memo(function DraggableCard({
  task,
  disabled,
  onOpen,
}: {
  task: TaskListItem;
  disabled: boolean;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled,
  });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={isDragging ? "opacity-40" : ""}>
      <TaskCard task={task} onOpen={onOpen} />
    </div>
  );
});

export default function ProjectBoardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { orgId, statuses, refreshProjects } = useV2Store();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [createIn, setCreateIn] = useState<string | null | false>(false); // false = закрыт, null/statusId = открыт
  const [membersOpen, setMembersOpen] = useState(false);
  const [dragTask, setDragTask] = useState<TaskListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const [p, ts] = await Promise.all([
        api.get<ProjectDetail>(`/orgs/${orgId}/projects/${projectId}`),
        api.get<TaskListItem[]>(`/orgs/${orgId}/projects/${projectId}/tasks${showDone ? "?done=1" : ""}`),
      ]);
      setProject(p);
      setTasks(ts);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Проект недоступен");
    }
  }, [orgId, projectId, showDone]);

  useEffect(() => {
    void load();
  }, [load]);

  const canEdit = project?.my_role === "admin" || project?.my_role === "editor";

  // Раскладка по колонкам — один проход по задачам. Прежний вариант фильтровал
  // весь массив заново для каждой колонки на каждый рендер: на 700 задачах и
  // семи статусах это тысячи проходов за перетаскивание.
  const columns = useMemo(() => {
    const known = new Set(statuses.map((s) => s.id));
    const byStatus = new Map<string, TaskListItem[]>();
    const noStatusTasks: TaskListItem[] = [];
    for (const t of tasks) {
      if (t.status_id && known.has(t.status_id)) {
        const bucket = byStatus.get(t.status_id);
        if (bucket) bucket.push(t);
        else byStatus.set(t.status_id, [t]);
      } else {
        noStatusTasks.push(t);
      }
    }
    // Архивные колонки скрыты, пока в них нет задач — иначе задача, отправленная
    // в архив из карточки, пропала бы с доски без следа.
    const visible = statuses.filter(
      (s) => showDone || s.kind !== "archived" || (byStatus.get(s.id)?.length ?? 0) > 0,
    );
    return { visible, byStatus, noStatusTasks };
  }, [statuses, tasks, showDone]);

  // Стабильная ссылка: инлайновый [] ломал бы memo дочерних компонентов.
  const openTask = useCallback((id: string) => setOpenTaskId(id), []);

  function onDragStart(e: DragStartEvent) {
    setDragTask(tasks.find((t) => t.id === e.active.id) ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragTask(null);
    const overId = e.over?.id;
    if (!orgId || !overId || typeof overId !== "string" || !overId.startsWith("status:")) return;
    const statusId = overId.slice("status:".length);
    const taskId = String(e.active.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status_id === statusId) return;
    // Оптимистично двигаем карточку в конец массива — колонки рендерятся в его
    // порядке, а на сервере задача тоже встаёт в конец (position = max + 1).
    const prev = tasks;
    setTasks((cur) => [
      ...cur.filter((t) => t.id !== taskId),
      { ...task, status_id: statusId },
    ]);
    try {
      const updated = await api.patch<TaskDetail>(`/orgs/${orgId}/tasks/${taskId}`, {
        status_id: statusId,
      });
      // Карточка встаёт в конец колонки, и этот порядок переживает перезагрузку:
      // список проекта сортируется по position.
      const columnTail = prev
        .filter((t) => t.status_id === statusId && t.id !== taskId)
        .map((t) => t.placements.find((p) => p.project_id === projectId)?.position ?? 0);
      const position = (columnTail.length > 0 ? Math.max(...columnTail) : 0) + 1;
      await api.post(`/orgs/${orgId}/tasks/${taskId}/placements`, {
        project_id: projectId,
        position,
      });
      // Вместо перезагрузки всей доски (сотни задач на каждое перетаскивание)
      // забираем из ответа то, что поменял сервер: перевод в «выполнено»
      // проставляет completed_at.
      setTasks((cur) =>
        cur.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status_id: updated.status_id,
                completed_at: updated.completed_at,
                placements: t.placements.map((p) =>
                  p.project_id === projectId ? { ...p, position } : p,
                ),
              }
            : t,
        ),
      );
      // Счётчик открытых задач в сайдбаре меняется при переводе в «выполнено».
      void refreshProjects();
    } catch {
      setTasks(prev);
    }
  }

  if (error) {
    return <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div>;
  }
  if (!project) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Загрузка…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <span className="size-3 rounded" style={{ backgroundColor: project.color }} />
        <h1 className="text-base font-semibold">{project.name}</h1>
        {project.visibility === "private" && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">приватный</span>
        )}
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="size-3.5 accent-primary"
          />
          Все задачи
        </label>
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
        {canEdit && (
          <Button size="sm" onClick={() => setCreateIn(null)}>
            <Plus className="size-4" />
            Задача
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex h-full gap-3 px-6 py-4">
            {columns.visible.map((s) => (
              <Column
                key={s.id}
                status={s}
                tasks={columns.byStatus.get(s.id) ?? EMPTY_TASKS}
                canEdit={!!canEdit}
                onOpenTask={openTask}
                onAdd={() => setCreateIn(s.id)}
              />
            ))}
            {columns.noStatusTasks.length > 0 && (
              <div className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/40">
                <div className="px-3 pb-1 pt-2.5 text-sm font-medium text-muted-foreground">Без статуса</div>
                <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2">
                  {columns.noStatusTasks.map((t) => (
                    <TaskCard key={t.id} task={t} onOpen={openTask} />
                  ))}
                </div>
              </div>
            )}
          </div>
          <DragOverlay>{dragTask ? <TaskCard task={dragTask} className="w-64 rotate-2" /> : null}</DragOverlay>
        </DndContext>
      </div>

      <TaskSheet
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        onChanged={() => {
          void load();
          void refreshProjects();
        }}
      />
      <CreateTaskDialog
        open={createIn !== false}
        onOpenChange={(open) => !open && setCreateIn(false)}
        projectId={projectId}
        statusId={createIn === false ? null : createIn}
        onCreated={() => {
          void load();
          void refreshProjects();
        }}
      />
      <ProjectMembersDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        project={project}
        onChanged={() => void load()}
      />
    </div>
  );
}
