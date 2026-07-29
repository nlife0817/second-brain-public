"use client";

// Канбан-доска проекта: колонки по статусам, drag&drop карточек между ними.
// Список задач принадлежит экрану (`ProjectBoardClient`) — доска и таблица
// показывают одни и те же строки и одинаково их правят.

import { memo, useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
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
import { Plus } from "lucide-react";
import { TaskCard } from "@/components/v2/TaskCard";
import { api } from "@/lib/core/client";
import { invalidate } from "@/lib/core/query";
import type { TaskDetail, TaskRow, TaskStatus } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { useViewStore } from "@/lib/core/view-store";
import { filterTasks, hiddenStatusIds, makeMatchContext } from "@/lib/core/views";

/** Общая пустая колонка: новый [] на каждый рендер ломал бы memo карточек. */
const EMPTY_TASKS: TaskRow[] = [];

/**
 * Сколько карточек колонка отрисовывает сразу. В проекте бывают сотни задач, а
 * каждая карточка на доске — ещё и draggable: без предела dnd-kit регистрирует
 * их все и пересчитывает на каждое движение мыши.
 */
const COLUMN_PAGE = 50;

/** Список карточек с пределом отрисовки — общий для колонок и «Без статуса». */
function CardList({
  tasks,
  draggable,
  canEdit,
  onOpenTask,
}: {
  tasks: TaskRow[];
  draggable: boolean;
  canEdit: boolean;
  onOpenTask: (id: string) => void;
}) {
  const [limit, setLimit] = useState(COLUMN_PAGE);
  const shown = tasks.length > limit ? tasks.slice(0, limit) : tasks;
  const rest = tasks.length - shown.length;
  return (
    <>
      {shown.map((t) =>
        draggable ? (
          <DraggableCard key={t.id} task={t} disabled={!canEdit} onOpen={onOpenTask} />
        ) : (
          <TaskCard key={t.id} task={t} onOpen={onOpenTask} />
        ),
      )}
      {rest > 0 && (
        <button
          onClick={() => setLimit((l) => l + COLUMN_PAGE)}
          className="rounded-lg border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          Показать ещё {Math.min(COLUMN_PAGE, rest)} · осталось {rest}
        </button>
      )}
    </>
  );
}

function Column({
  status,
  tasks,
  canEdit,
  onOpenTask,
  onAdd,
}: {
  status: TaskStatus;
  tasks: TaskRow[];
  canEdit: boolean;
  onOpenTask: (id: string) => void;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `status:${status.id}` });
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
        <CardList tasks={tasks} draggable canEdit={canEdit} onOpenTask={onOpenTask} />
      </div>
    </div>
  );
}

const DraggableCard = memo(function DraggableCard({
  task,
  disabled,
  onOpen,
}: {
  task: TaskRow;
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

export function ProjectBoard({
  projectId,
  projectPath,
  tasks,
  setTasks,
  canEdit,
  onOpenTask,
  onAddTask,
}: {
  projectId: string;
  /** Ключ клиентского кэша доски — устаревает после перетаскивания. */
  projectPath: string | null;
  tasks: TaskRow[];
  setTasks: Dispatch<SetStateAction<TaskRow[]>>;
  canEdit: boolean;
  onOpenTask: (id: string) => void;
  onAddTask: (statusId: string | null) => void;
}) {
  const { orgId, statuses, me, refreshProjects } = useV2Store();
  // Фильтры у доски и таблицы общие (один ViewScope проекта) — архив и
  // завершённое показываются там и там по одним и тем же условиям
  // «Архив/Готово = Показать», а условия фильтра и поиск отсеивают карточки
  // ровно как строки таблицы: кнопки в шапке одни и те же.
  const filterGroups = useViewStore((s) => s.groups);
  const search = useViewStore((s) => s.search);
  const matchCtx = useMemo(() => makeMatchContext(me?.id ?? null), [me?.id]);
  const [dragTask, setDragTask] = useState<TaskRow | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Раскладка по колонкам — один проход по задачам. Прежний вариант фильтровал
  // весь массив заново для каждой колонки на каждый рендер: на 700 задачах и
  // семи статусах это тысячи проходов за перетаскивание.
  const columns = useMemo(() => {
    const known = new Set(statuses.map((s) => s.id));
    const hidden = hiddenStatusIds(filterGroups, statuses);
    const matched = new Set(filterTasks(tasks, filterGroups, search, matchCtx).map((t) => t.id));
    const byStatus = new Map<string, TaskRow[]>();
    const noStatusTasks: TaskRow[] = [];
    for (const t of tasks) {
      // Скрытая группа не просто убирает колонку: сама задача не должна
      // всплыть нигде — ни в «Без статуса», ни в счётчиках.
      if (t.status_id && hidden.has(t.status_id)) continue;
      if (!matched.has(t.id)) continue;
      if (t.status_id && known.has(t.status_id)) {
        const bucket = byStatus.get(t.status_id);
        if (bucket) bucket.push(t);
        else byStatus.set(t.status_id, [t]);
      } else {
        noStatusTasks.push(t);
      }
    }
    // Колонку убираем только у архива. «Готово» — конец рабочего потока: без
    // него карточку на доске нечем завершить, а перетащенная туда задача просто
    // уходит с доски вместе с остальными завершёнными.
    const visible = statuses.filter((s) => s.kind !== "archived" || !hidden.has(s.id));
    return { visible, byStatus, noStatusTasks };
  }, [statuses, tasks, filterGroups, search, matchCtx]);

  const openNoStatusAdd = useCallback(() => onAddTask(null), [onAddTask]);

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
      // Доска осталась актуальной локально, но в кэше лежит расклад до
      // перетаскивания: без сброса возврат на доску вернул бы карточку назад.
      if (projectPath) invalidate(projectPath);
    } catch {
      setTasks(prev);
    }
  }

  return (
    <div className="flex-1 overflow-x-auto overflow-y-hidden">
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex h-full gap-3 px-6 py-4">
          {columns.visible.map((s) => (
            <Column
              key={s.id}
              status={s}
              tasks={columns.byStatus.get(s.id) ?? EMPTY_TASKS}
              canEdit={canEdit}
              onOpenTask={onOpenTask}
              onAdd={() => onAddTask(s.id)}
            />
          ))}
          {columns.noStatusTasks.length > 0 && (
            <div className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/40">
              <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
                <span className="text-sm font-medium text-muted-foreground">Без статуса</span>
                <span className="text-xs text-muted-foreground">{columns.noStatusTasks.length}</span>
                <span className="flex-1" />
                {canEdit && (
                  <button
                    onClick={openNoStatusAdd}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2">
                <CardList
                  tasks={columns.noStatusTasks}
                  draggable={false}
                  canEdit={canEdit}
                  onOpenTask={onOpenTask}
                />
              </div>
            </div>
          )}
        </div>
        <DragOverlay>{dragTask ? <TaskCard task={dragTask} className="w-64 rotate-2" /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
