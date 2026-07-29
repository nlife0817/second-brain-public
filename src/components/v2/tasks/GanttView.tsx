"use client";

// Гант: слева список задач группами, справа полотно с полосами. Оба экрана —
// «Все задачи» и проект — рисуют его одним компонентом: настройки, фильтры и
// поиск у всех видов общие (`ViewStore`), и вид, считающий свой собственный
// срез, показывал бы по тому же фильтру другие задачи.
//
// Прокрутка одна на всё тело: левый столбец и шапка шкалы прилипают
// (`position: sticky`), а не едут в своих контейнерах. Два скроллера,
// синхронизируемых из JS, расходятся на инерционной прокрутке трекпада — и это
// видно как «поехавшие» строки относительно полос.
//
// Даты правятся прямо здесь: полоса переносится и растягивается за края, а
// задаче без дат их назначает протягивание по её пустой строке. Правка
// оптимистичная с откатом — так же, как в таблице.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { PriorityDot, formatDue } from "@/components/v2/bits";
import { useGroupNaming } from "@/components/v2/tasks/group-naming";
import { GANTT_SECTIONS, ViewSettingsPopover } from "@/components/v2/tasks/ViewControls";
import { FilterButton, TaskCount, TaskSearch } from "@/components/v2/tasks/ViewToolbar";
import { api } from "@/lib/core/client";
import {
  DAY_WIDTH,
  SCALE_LABELS,
  addDays,
  barOf,
  buildTicks,
  daysOf,
  dragBar,
  ganttRange,
  isWeekend,
  spanOf,
  widthOf,
  xOf,
  type DragKind,
  type GanttBar,
  type GanttScale,
} from "@/lib/core/gantt";
import { invalidate } from "@/lib/core/query";
import type { TaskDependency, TaskDetail, TaskRow } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { useViewStore } from "@/lib/core/view-store";
import {
  arrangeRows,
  buildGroups,
  compareTasks,
  filterTasks,
  makeMatchContext,
  todayIso,
  visiblePool,
  type GroupLabel,
  type GroupNode,
  type SubtaskMode,
} from "@/lib/core/views";
import { cn } from "@/lib/utils";

/** Высота строки. Совпадает с плотностью таблицы — виды переключают на глаз. */
const ROW_H = 32;
/** Высота одной строки шапки шкалы; строк две. */
const HEAD_ROW_H = 22;
const HEAD_H = HEAD_ROW_H * 2;
/** Ширина левого столбца со списком задач. */
const LIST_W = 300;
/** Зона у края полосы, за которую её растягивают. */
const HANDLE_W = 6;
/** Сдвиг указателя, ниже которого жест считается кликом, а не перетаскиванием. */
const CLICK_SLOP = 3;

// --- Строки ----------------------------------------------------------------------

type GanttRow =
  | { kind: "group"; path: string; label: GroupLabel; depth: number; count: number; span: { from: string; to: string } | null }
  | { kind: "task"; task: TaskRow; depth: number; bar: GanttBar | null };

/**
 * Плоский список строк из дерева групп. Свёрнутая группа оставляет только свою
 * строку — вместе со сводной полосой, иначе сворачивание прячет и то, что в
 * группе вообще что-то запланировано.
 */
function flattenRows(
  groups: GroupNode[],
  collapsed: ReadonlySet<string>,
  subtaskMode: SubtaskMode,
  today: string,
): GanttRow[] {
  const out: GanttRow[] = [];

  const pushTasks = (tasks: TaskRow[], baseDepth: number) => {
    for (const { task, depth } of arrangeRows(tasks, subtaskMode)) {
      out.push({ kind: "task", task, depth: baseDepth + depth, bar: barOf(task, today) });
    }
  };

  const barsOf = (tasks: TaskRow[]) =>
    tasks.map((t) => barOf(t, today)).filter((b): b is GanttBar => b !== null);

  for (const group of groups) {
    // Группировки нет — таблица отдаёт единственную псевдогруппу, и рисовать её
    // заголовком незачем.
    const bare = group.path === "__all__";
    if (!bare) {
      out.push({
        kind: "group",
        path: group.path,
        label: group.label,
        depth: 0,
        count: group.tasks.length,
        span: spanOf(barsOf(group.tasks)),
      });
      if (collapsed.has(group.path)) continue;
    }

    if (group.children.length === 0) {
      pushTasks(group.tasks, bare ? 0 : 1);
      continue;
    }
    for (const child of group.children) {
      out.push({
        kind: "group",
        path: child.path,
        label: child.label,
        depth: 1,
        count: child.tasks.length,
        span: spanOf(barsOf(child.tasks)),
      });
      if (collapsed.has(child.path)) continue;
      pushTasks(child.tasks, 2);
    }
  }
  return out;
}

// --- Перетаскивание --------------------------------------------------------------

interface DragState {
  taskId: string;
  kind: DragKind | "create";
  /** Сдвиг в днях для полосы; для «create» — день, где жест начался. */
  days: number;
  anchorDay: string;
  moved: boolean;
}

/** Полоса, какой она выглядит прямо сейчас — с учётом незавершённого жеста. */
function previewOf(bar: GanttBar, drag: DragState | null): GanttBar {
  if (!drag || drag.taskId !== bar.taskId || drag.kind === "create" || drag.days === 0) return bar;
  const patch = dragBar(bar, drag.kind, drag.days);
  return {
    ...bar,
    start: (patch.start_date as string) ?? bar.start,
    end: (patch.due_date as string) ?? bar.end,
  };
}

// --- Компонент -------------------------------------------------------------------

export interface GanttViewProps {
  tasks: TaskRow[];
  setTasks: Dispatch<SetStateAction<TaskRow[]>>;
  /** Ключ клиентского кэша: после правки его надо сбросить. */
  invalidateKey: string | null;
  reload: () => Promise<void>;
  loading?: boolean;
  error?: string | null;
  onDismissError?: () => void;
  onOpenTask: (taskId: string) => void;
  titleSlot: ReactNode;
  actionsSlot?: ReactNode;
  emptyText?: string;
}

export function GanttView({
  tasks,
  setTasks,
  invalidateKey,
  reload,
  loading = false,
  error: externalError = null,
  onDismissError,
  onOpenTask,
  titleSlot,
  actionsSlot,
  emptyText = "Задач нет.",
}: GanttViewProps) {
  const { orgId, statuses, projects, fields, me, orgRole } = useV2Store();
  const canEdit = orgRole !== "guest" && orgRole !== null;

  const filterGroups = useViewStore((s) => s.groups);
  const search = useViewStore((s) => s.search);
  const sort = useViewStore((s) => s.sort);
  const groupBy = useViewStore((s) => s.groupBy);
  const subtaskMode = useViewStore((s) => s.subtaskMode);
  const collapsedList = useViewStore((s) => s.collapsed);
  const toggleCollapsed = useViewStore((s) => s.toggleCollapsed);
  const scale = useViewStore((s) => s.ganttScale);
  const setScale = useViewStore((s) => s.setGanttScale);

  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [deps, setDeps] = useState<TaskDependency[]>([]);

  const naming = useGroupNaming();
  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList]);
  const matchCtx = useMemo(() => makeMatchContext(me?.id ?? null), [me?.id]);
  // Сегодня считается один раз на монтирование: пересчёт в рендере означал бы
  // новую ссылку на каждую перерисовку и «дрожащую» линию текущего дня.
  const today = useMemo(() => todayIso(), []);

  // --- Данные ---------------------------------------------------------------------

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

  const rows = useMemo(
    () => flattenRows(buildGroups(visibleTasks, groupBy, matchCtx, naming), collapsed, subtaskMode, today),
    [visibleTasks, groupBy, matchCtx, naming, collapsed, subtaskMode, today],
  );

  const bars = useMemo(
    () => rows.flatMap((r) => (r.kind === "task" && r.bar ? [r.bar] : [])),
    [rows],
  );

  const range = useMemo(() => ganttRange(bars, today, scale), [bars, today, scale]);
  const days = useMemo(() => daysOf(range), [range]);
  const ticks = useMemo(() => buildTicks(range, scale), [range, scale]);
  const canvasWidth = days.length * DAY_WIDTH[scale];

  // Зависимости приезжают одним запросом на организацию: связей на порядки
  // меньше, чем задач, а список показанных id промахивался бы мимо кэша при
  // каждом движении фильтра.
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    api
      .get<TaskDependency[]>(`/orgs/${orgId}/dependencies`)
      .then((d) => {
        if (alive) setDeps(d);
      })
      // Стрелки — украшение поверх полос: их отсутствие не повод рушить экран.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [orgId]);

  /** Где какая полоса лежит — для стрелок зависимостей. */
  const placement = useMemo(() => {
    const map = new Map<string, { row: number; bar: GanttBar }>();
    rows.forEach((r, i) => {
      if (r.kind === "task" && r.bar) map.set(r.task.id, { row: i, bar: r.bar });
    });
    return map;
  }, [rows]);

  // --- Правка ---------------------------------------------------------------------

  // Зеркало списка для обработчиков: см. комментарий в patchTask.
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const patchTask = useCallback(
    async (taskId: string, payload: Record<string, unknown>) => {
      if (!orgId || Object.keys(payload).length === 0) return;
      // Состояние до правки читаем из ref-зеркала, а не внутри апдейтера:
      // побочный эффект в нём выполняется столько раз, сколько React решит
      // прогнать обновление, и брать `tasks` в зависимости тоже нельзя —
      // обработчик пересоздавался бы на каждое изменение списка и обнулял memo
      // строк.
      const before = tasksRef.current.find((t) => t.id === taskId);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...payload } : t)));
      try {
        const updated = await api.patch<TaskDetail>(`/orgs/${orgId}/tasks/${taskId}`, payload);
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? { ...t, start_date: updated.start_date, due_date: updated.due_date, updated_at: updated.updated_at }
              : t,
          ),
        );
        setError(null);
        // Экран верен, а в кэше лежит расклад до правки: без сброса возврат на
        // экран показал бы прежние даты.
        if (invalidateKey) invalidate(invalidateKey);
      } catch (e) {
        // Откат: интерфейс, который врёт после отказа сети, хуже отсутствия
        // оптимизма — человек уверен, что срок сдвинут.
        if (before) setTasks((prev) => prev.map((t) => (t.id === taskId ? before! : t)));
        setError(e instanceof Error ? e.message : "Не удалось сохранить даты");
      }
    },
    [orgId, setTasks, invalidateKey],
  );

  // --- Жесты ----------------------------------------------------------------------

  // Живое состояние жеста — в ref: события указателя приходят пачками, и
  // замыкание рендера теряет те, что пришли до перерисовки. Ширина дня
  // запоминается на старте: жест должен считать в том масштабе, в котором его
  // начали, даже если масштаб переключили посреди перетаскивания.
  const dragRef = useRef<{ startX: number; dayWidth: number; state: DragState } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent, taskId: string, kind: DragKind | "create", anchorDay: string, dayWidth: number) => {
      if (!canEdit || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const state: DragState = { taskId, kind, days: 0, anchorDay, moved: false };
      dragRef.current = { startX: e.clientX, dayWidth, state };
      setDrag(state);
    },
    [canEdit],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const active = dragRef.current;
    if (!active) return;
    const dx = e.clientX - active.startX;
    const days = Math.round(dx / active.dayWidth);
    const moved = active.state.moved || Math.abs(dx) > CLICK_SLOP;
    if (days === active.state.days && moved === active.state.moved) return;
    active.state = { ...active.state, days, moved };
    setDrag(active.state);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const active = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!active) return;
      const target = e.currentTarget as HTMLElement;
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);

      const { state } = active;
      // Жест без движения — обычный клик по полосе: открываем карточку.
      if (!state.moved) {
        if (state.kind !== "create") onOpenTask(state.taskId);
        return;
      }

      if (state.kind === "create") {
        // Протягивание по пустой строке задаёт задаче обе даты сразу: у неё их
        // не было, и одна ничего бы не изменила — полоса всё равно осталась бы
        // вехой.
        const other = addDays(state.anchorDay, state.days);
        const [from, to] = state.anchorDay <= other ? [state.anchorDay, other] : [other, state.anchorDay];
        void patchTask(state.taskId, { start_date: from, due_date: to });
        return;
      }

      const bar = placement.get(state.taskId)?.bar;
      if (bar) void patchTask(state.taskId, dragBar(bar, state.kind, state.days));
    },
    [onOpenTask, patchTask, placement],
  );

  // --- Прокрутка к сегодня ---------------------------------------------------------

  const scrollRef = useRef<HTMLDivElement>(null);
  const centered = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    // Один раз за открытие вида: дальше человек листает сам, и рывок к
    // сегодняшнему дню после каждой правки был бы издевательством.
    if (!el || centered.current || rows.length === 0) return;
    centered.current = true;
    el.scrollLeft = Math.max(0, xOf(today, range, scale) - LIST_W);
  }, [rows.length, today, range, scale]);

  const shownError = externalError ?? error;
  const todayX = today >= range.from && today <= range.to ? xOf(today, range, scale) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        {titleSlot}
        <TaskCount shown={visibleTasks.length} total={pool.length} />
        <TaskSearch />
        <FilterButton />
        <ScaleSwitch scale={scale} onChange={setScale} />
        <span className="flex-1" />
        {actionsSlot}
        {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        <ViewSettingsPopover customFields={fields} sections={GANTT_SECTIONS} />
      </header>

      {shownError && (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          <span className="flex-1">{shownError}</span>
          <button
            onClick={() => {
              setError(null);
              onDismissError?.();
              void reload();
            }}
            className="rounded p-0.5 hover:bg-destructive/20"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{emptyText}</div>
      ) : (
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
          <div className="flex" style={{ width: LIST_W + canvasWidth }}>
            {/* Левый столбец прилипает к левому краю, шапка — к верхнему;
                угловая ячейка держится обоих сразу. */}
            <div
              className="sticky left-0 z-20 shrink-0 border-r border-border bg-background"
              style={{ width: LIST_W }}
            >
              <div
                className="sticky top-0 z-10 flex items-end border-b border-border bg-background px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                style={{ height: HEAD_H }}
              >
                Задача
              </div>
              {rows.map((row, i) => (
                <ListRow
                  key={row.kind === "group" ? row.path : row.task.id + i}
                  row={row}
                  collapsed={row.kind === "group" && collapsed.has(row.path)}
                  onToggle={toggleCollapsed}
                  onOpen={onOpenTask}
                />
              ))}
            </div>

            <div className="relative" style={{ width: canvasWidth }}>
              <TimelineHead ticks={ticks} scale={scale} range={range} />

              <div className="relative" style={{ height: rows.length * ROW_H }}>
                {/* Фон: выходные и вертикальная сетка. Один слой на всё
                    полотно — по div на день в каждой строке это тысячи узлов. */}
                <div className="pointer-events-none absolute inset-0">
                  {scale !== "month" &&
                    days.map((iso, i) =>
                      isWeekend(iso) ? (
                        <div
                          key={iso}
                          className="absolute top-0 bottom-0 bg-muted/40"
                          style={{ left: i * DAY_WIDTH[scale], width: DAY_WIDTH[scale] }}
                        />
                      ) : null,
                    )}
                  {ticks.minor.map((t) => (
                    <div
                      key={t.key}
                      className="absolute top-0 bottom-0 w-px bg-border/60"
                      style={{ left: xOf(t.start, range, scale) }}
                    />
                  ))}
                </div>

                {todayX !== null && (
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-primary/70"
                    style={{ left: todayX }}
                  />
                )}

                <DependencyArrows deps={deps} placement={placement} range={range} scale={scale} drag={drag} />

                {rows.map((row, i) => (
                  <CanvasRow
                    key={row.kind === "group" ? row.path : row.task.id + i}
                    row={row}
                    index={i}
                    range={range}
                    scale={scale}
                    // Жест получает только та строка, которую тянут: `drag`
                    // меняется на каждое движение мыши, и общий проп сводил бы
                    // memo на нет — перерисовывались бы все сотни строк.
                    drag={drag && row.kind === "task" && drag.taskId === row.task.id ? drag : null}
                    canEdit={canEdit}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Шапка шкалы -----------------------------------------------------------------

function ScaleSwitch({ scale, onChange }: { scale: GanttScale; onChange: (s: GanttScale) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {(Object.keys(SCALE_LABELS) as GanttScale[]).map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={cn(
            "rounded-md px-2 py-1 text-xs font-medium transition-colors",
            scale === s ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {SCALE_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

const TimelineHead = memo(function TimelineHead({
  ticks,
  scale,
  range,
}: {
  ticks: ReturnType<typeof buildTicks>;
  scale: GanttScale;
  range: { from: string };
}) {
  return (
    <div
      className="sticky top-0 z-10 border-b border-border bg-background"
      style={{ height: HEAD_H }}
    >
      {ticks.major.map((t) => (
        <div
          key={t.key}
          className="absolute flex items-center border-r border-border px-2 text-[11px] font-medium text-muted-foreground"
          style={{
            left: xOf(t.start, range, scale),
            width: t.days * DAY_WIDTH[scale],
            height: HEAD_ROW_H,
            top: 0,
          }}
        >
          <span className="truncate">{t.label}</span>
        </div>
      ))}
      {ticks.minor.map((t) => (
        <div
          key={t.key}
          className="absolute flex items-center justify-center border-r border-border/60 text-[10px] tabular-nums text-muted-foreground"
          style={{
            left: xOf(t.start, range, scale),
            width: t.days * DAY_WIDTH[scale],
            height: HEAD_ROW_H,
            top: HEAD_ROW_H,
          }}
        >
          <span className="truncate px-0.5">{t.label}</span>
        </div>
      ))}
    </div>
  );
});

// --- Строка списка ---------------------------------------------------------------

const ListRow = memo(function ListRow({
  row,
  collapsed,
  onToggle,
  onOpen,
}: {
  row: GanttRow;
  collapsed: boolean;
  onToggle: (path: string) => void;
  onOpen: (taskId: string) => void;
}) {
  if (row.kind === "group") {
    return (
      <button
        onClick={() => onToggle(row.path)}
        className="flex w-full items-center gap-1.5 border-b border-border/60 bg-muted/30 px-2 text-left hover:bg-muted/60"
        style={{ height: ROW_H, paddingLeft: 8 + row.depth * 12 }}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        {row.label.color && (
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.label.color }} />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{row.label.text}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{row.count}</span>
      </button>
    );
  }

  const { task } = row;
  return (
    <button
      onClick={() => onOpen(task.id)}
      className="flex w-full items-center gap-1.5 border-b border-border/40 px-2 text-left hover:bg-muted/50"
      style={{ height: ROW_H, paddingLeft: 8 + row.depth * 12 }}
      title={task.title}
    >
      <PriorityDot priority={task.priority} />
      <span className={cn("min-w-0 flex-1 truncate text-xs", task.completed_at && "text-muted-foreground line-through")}>
        {task.title}
      </span>
      {!row.bar && <span className="shrink-0 text-[10px] text-muted-foreground/70">без дат</span>}
    </button>
  );
});

// --- Строка полотна --------------------------------------------------------------

const CanvasRow = memo(function CanvasRow({
  row,
  index,
  range,
  scale,
  drag,
  canEdit,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  row: GanttRow;
  index: number;
  range: { from: string };
  scale: GanttScale;
  drag: DragState | null;
  canEdit: boolean;
  onPointerDown: (
    e: React.PointerEvent,
    taskId: string,
    kind: DragKind | "create",
    anchorDay: string,
    dayWidth: number,
  ) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}) {
  const top = index * ROW_H;

  if (row.kind === "group") {
    if (!row.span) return null;
    // Сводная полоса группы: от самого раннего начала до самого позднего срока.
    // Тонкая и без обводки — её нельзя перепутать с задачей и нельзя тянуть.
    return (
      <div
        className="pointer-events-none absolute rounded-sm bg-muted-foreground/25"
        style={{
          top: top + ROW_H / 2 - 3,
          height: 6,
          left: xOf(row.span.from, range, scale),
          width: widthOf({ start: row.span.from, end: row.span.to }, scale),
        }}
      />
    );
  }

  const { task, bar } = row;

  // Задача без дат: пустая строка, по которой их и протягивают.
  if (!bar) {
    const creating = drag?.taskId === task.id && drag.kind === "create";
    const preview = creating
      ? (() => {
          const other = addDays(drag.anchorDay, drag.days);
          const [from, to] = drag.anchorDay <= other ? [drag.anchorDay, other] : [other, drag.anchorDay];
          return { from, to };
        })()
      : null;

    return (
      <div
        className={cn("absolute inset-x-0", canEdit && "cursor-crosshair")}
        style={{ top, height: ROW_H }}
        onPointerDown={(e) => {
          if (!canEdit) return;
          const host = e.currentTarget.getBoundingClientRect();
          const day = addDays(range.from, Math.floor((e.clientX - host.left) / DAY_WIDTH[scale]));
          onPointerDown(e, task.id, "create", day, DAY_WIDTH[scale]);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {preview && (
          <div
            className="absolute rounded-md border border-dashed border-primary bg-primary/20"
            style={{
              top: 5,
              height: ROW_H - 10,
              left: xOf(preview.from, range, scale),
              width: widthOf({ start: preview.from, end: preview.to }, scale),
            }}
          />
        )}
      </div>
    );
  }

  const shown = previewOf(bar, drag);
  const left = xOf(shown.start, range, scale);
  const width = widthOf(shown, scale);
  const label = shown.milestone
    ? formatDue(shown.start, null)
    : `${formatDue(shown.start, null)} — ${formatDue(shown.end, null)}`;

  const tone = shown.done
    ? "bg-muted-foreground/40"
    : shown.overdue
      ? "bg-destructive"
      : shown.invalid
        ? "bg-amber-500"
        : "bg-primary";

  if (shown.milestone) {
    // Веха — ромб по центру дня: у неё нет длительности, и отрезок в один день
    // читался бы как «работа на сутки», чего никто не планировал.
    const size = Math.min(DAY_WIDTH[scale], ROW_H) - 12;
    return (
      <div
        className={cn("absolute", canEdit && "cursor-grab")}
        style={{ top, height: ROW_H, left, width: DAY_WIDTH[scale] }}
        onPointerDown={(e) => onPointerDown(e, task.id, "move", shown.start, DAY_WIDTH[scale])}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title={`${task.title} · ${label}`}
      >
        <span
          className={cn("absolute rotate-45 rounded-[2px]", tone)}
          style={{
            width: Math.max(8, size),
            height: Math.max(8, size),
            left: `calc(50% - ${Math.max(8, size) / 2}px)`,
            top: `calc(50% - ${Math.max(8, size) / 2}px)`,
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn("group absolute flex items-center rounded-md", tone, canEdit && "cursor-grab")}
      style={{ top: top + 5, height: ROW_H - 10, left, width }}
      onPointerDown={(e) => onPointerDown(e, task.id, "move", shown.start, DAY_WIDTH[scale])}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      title={`${task.title} · ${label}`}
    >
      {canEdit && (
        <span
          className="absolute inset-y-0 left-0 cursor-ew-resize rounded-l-md"
          style={{ width: HANDLE_W }}
          onPointerDown={(e) => onPointerDown(e, task.id, "resize-start", shown.start, DAY_WIDTH[scale])}
        />
      )}
      <span className="pointer-events-none min-w-0 flex-1 truncate px-2 text-[11px] font-medium text-white">
        {width > 56 ? task.title : ""}
      </span>
      {canEdit && (
        <span
          className="absolute inset-y-0 right-0 cursor-ew-resize rounded-r-md"
          style={{ width: HANDLE_W }}
          onPointerDown={(e) => onPointerDown(e, task.id, "resize-end", shown.end, DAY_WIDTH[scale])}
        />
      )}
    </div>
  );
});

// --- Стрелки зависимостей --------------------------------------------------------

const DependencyArrows = memo(function DependencyArrows({
  deps,
  placement,
  range,
  scale,
  drag,
}: {
  deps: TaskDependency[];
  placement: Map<string, { row: number; bar: GanttBar }>;
  range: { from: string };
  scale: GanttScale;
  drag: DragState | null;
}) {
  const paths = useMemo(() => {
    const out: Array<{ key: string; d: string; head: string; late: boolean }> = [];
    for (const dep of deps) {
      const from = placement.get(dep.from);
      const to = placement.get(dep.to);
      // Обе стороны должны быть в текущем срезе: рисовать стрелку в пустоту
      // значит показывать связь с задачей, которую фильтр убрал.
      if (!from || !to) continue;

      const fromBar = previewOf(from.bar, drag);
      const toBar = previewOf(to.bar, drag);
      const x1 = xOf(fromBar.end, range, scale) + DAY_WIDTH[scale];
      const y1 = from.row * ROW_H + ROW_H / 2;
      const x2 = xOf(toBar.start, range, scale);
      const y2 = to.row * ROW_H + ROW_H / 2;

      const r = 10;
      const d =
        x2 >= x1 + 2 * r
          ? `M ${x1} ${y1} H ${x2 - r} V ${y2} H ${x2}`
          : // Цель левее источника — обходим по промежутку между строками.
            `M ${x1} ${y1} H ${x1 + r} V ${y1 + (y2 > y1 ? ROW_H / 2 : -ROW_H / 2)} H ${x2 - r} V ${y2} H ${x2}`;

      out.push({
        key: `${dep.from}->${dep.to}`,
        d,
        head: `M ${x2} ${y2} l -5 -3.5 l 0 7 z`,
        // Нарушенная зависимость: то, что блокирует, кончается позже, чем
        // начинается зависимое. Ровно это гант и должен показывать.
        late: toBar.start < fromBar.end,
      });
    }
    return out;
  }, [deps, placement, range, scale, drag]);

  if (paths.length === 0) return null;

  return (
    <svg className="pointer-events-none absolute inset-0 z-[5] size-full overflow-visible">
      {paths.map((p) => (
        <g key={p.key} className={p.late ? "text-destructive" : "text-muted-foreground/70"}>
          <path d={p.d} fill="none" stroke="currentColor" strokeWidth={1.5} />
          <path d={p.head} fill="currentColor" />
        </g>
      ))}
    </svg>
  );
});
