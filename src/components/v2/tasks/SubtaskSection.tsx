"use client";

// Подзадачи в карточке задачи. Подзадача — обычная задача с родителем, поэтому
// и заводится она так же, как в «Все задачи»: черновиком со всеми полями, а не
// одной строкой названия.
//
// Колонок в карточке нет (её ширина — 576 px), поэтому редакторы полей собраны
// в компактные чипы над теми же меню, что и в строке таблицы (`draft-controls`).
// «Развернуть» раскрывает остальные поля прямо здесь: второй боковой панелью
// поверх карточки это на телефоне давало бы две наложенные шторки.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpNarrowWide,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Clock,
  Filter,
  GripVertical,
  Link2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  Unlink,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AvatarStack,
  PRIORITY_LABELS,
  PriorityDot,
  chipStyle,
  dueTone,
  formatDue,
} from "@/components/v2/bits";
import { DuePicker } from "@/components/v2/DuePicker";
import { TaskSearchField, type TaskHit } from "@/components/v2/TaskPicker";
import { defaultStatus } from "@/lib/core/status-model";
import {
  SUBTASK_SORT_COLUMNS,
  SUBTASK_SORT_LABELS,
  filterSubtasks,
  sortSubtasks,
  subtaskFiltersActive,
} from "@/lib/core/subtask-view";
import { emptyDraft, isDraftFilled, type TaskDraft } from "@/lib/core/task-draft";
import type { CustomField, TaskListItem, TaskPriority } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { useSubtaskViewStore } from "@/lib/core/view-store";
import { NONE_VALUE, type SortContext } from "@/lib/core/views";
import { cn } from "@/lib/utils";
import { formatEstimate } from "./cells";
import {
  AssigneesMenu,
  ESTIMATE_POPOVER,
  EstimateForm,
  FIELD_POPOVER,
  MENU_POPOVER,
  PRIORITY_POPOVER,
  PriorityMenu,
  ProjectsMenu,
  StatusMenu,
  TagsMenu,
  WIDE_MENU_POPOVER,
} from "./draft-controls";
import { DraftFieldControl, describeFieldValue } from "./draft-fields";
import { useRowDrag, type RowDragApi } from "./use-row-drag";

const RichText = dynamic(() => import("@/components/v2/RichText").then((m) => m.RichText), {
  ssr: false,
  loading: () => (
    <div className="min-h-16 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
      Загрузка редактора…
    </div>
  ),
});

const CHIP =
  "flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const CHIP_EMPTY = "text-muted-foreground/70";
const CHIP_SET = "text-foreground";

/**
 * Незаполненный параметр подзадачи: строка не должна шуметь пятью пустыми
 * плейсхолдерами, поэтому такой чип проявляется по наведению.
 *
 * `data-[popup-open]` обязателен — иначе уведённая с строки мышь гасит чип
 * вместе с его открытым меню. На телефоне наведения не существует, а карточку
 * там открывают три экрана: под `[data-mobile-v2]` (атрибут стоит на `<html>`)
 * пустые чипы видны всегда, иначе параметры подзадачи недостижимы вовсе.
 */
const CHIP_ON_HOVER =
  "opacity-0 transition-opacity focus-visible:opacity-100 data-[popup-open]:opacity-100 " +
  "group-hover/sub:opacity-100 group-focus-within/sub:opacity-100 [[data-mobile-v2]_&]:opacity-100";

export function SubtaskSection({
  subtasks,
  canEdit,
  defaults,
  chainProjectIds,
  onCreate,
  onLinkExisting,
  linkExcludeIds,
  onToggleDone,
  onOpen,
  onPatch,
  onDelete,
  onDetach,
  onReorder,
}: {
  subtasks: TaskListItem[];
  canEdit: boolean;
  /** Что карточка проставляет в черновик подзадачи — проекты родителя и т.п. */
  defaults: Partial<TaskDraft>;
  /** Проекты цепочки родителя: по ним сужается выбор исполнителей подзадачи. */
  chainProjectIds: string[];
  onCreate: (draft: TaskDraft) => Promise<void>;
  /** Подчинить этой задаче уже существующую. */
  onLinkExisting: (hit: TaskHit) => Promise<void>;
  /** Кого не предлагать в поиске: сама задача и её нынешние подзадачи. */
  linkExcludeIds: string[];
  onToggleDone: (sub: TaskListItem) => void;
  onOpen: (taskId: string) => void;
  onPatch: (sub: TaskListItem, body: Record<string, unknown>) => void;
  onDelete: (sub: TaskListItem) => void;
  onDetach: (sub: TaskListItem) => void;
  /** Новый порядок ветки целиком — так же, как его принимает сервер. */
  onReorder: (taskIds: string[]) => void;
}) {
  const done = subtasks.filter((s) => s.completed_at).length;
  const [linkOpen, setLinkOpen] = useState(false);
  const statuses = useV2Store((s) => s.statuses);
  const projects = useV2Store((s) => s.projects);
  const sort = useSubtaskViewStore((s) => s.sort);
  const direction = useSubtaskViewStore((s) => s.direction);
  const filters = useSubtaskViewStore((s) => s.filters);

  const sortCtx = useMemo<SortContext>(
    () => ({
      statusPosition: new Map(statuses.map((s) => [s.id, s.position])),
      projectPosition: new Map(projects.map((p) => [p.id, p.position])),
      projectName: new Map(projects.map((p) => [p.id, p.name])),
    }),
    [statuses, projects],
  );

  // Порядок и отсев считаются здесь, а не в карточке: `subtasks` — это ветка
  // как она есть на сервере, и перетаскивание обязано работать с ней, а не с
  // тем, что осталось после фильтра.
  const ordered = useMemo(
    () => sortSubtasks(subtasks, sort, direction, sortCtx),
    [subtasks, sort, direction, sortCtx],
  );
  const shown = useMemo(() => filterSubtasks(ordered, filters), [ordered, filters]);

  // Перетаскивание — только в ручном порядке: при сортировке по полю строка
  // вернулась бы на место в тот же кадр, и жест выглядел бы сломанным. Фильтр
  // отключает его по той же причине: между двумя видимыми строками может стоять
  // спрятанная, и «поставить сюда» означало бы не то, что видно.
  const canDrag = canEdit && sort === "manual" && shown.length === subtasks.length && subtasks.length > 1;

  const drag = useRowDrag(shown.length, (from, to) => {
    const ids = shown.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    onReorder(ids);
  });

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Подзадачи
        {subtasks.length > 0 && (
          <>
            {/* Полоска прогресса: доля закрытых видна без чтения счётчика.
                Считается по всей ветке — фильтр меняет показ, а не работу. */}
            <span className="h-1 w-20 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${Math.round((done / subtasks.length) * 100)}%` }}
              />
            </span>
            <span className="tabular-nums font-normal normal-case tracking-normal">
              {done}/{subtasks.length}
            </span>
            {shown.length !== subtasks.length && (
              <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
                · показано {shown.length}
              </span>
            )}
          </>
        )}
        {/* Настройки показа и «связать» — одной группой справа: три отдельных
            прижатия к краю разъезжались бы при переносе строки. */}
        <span className="ml-auto flex items-center gap-0.5">
          {subtasks.length > 1 && (
            <>
              <SubtaskSortMenu />
              <SubtaskFilterMenu subtasks={subtasks} />
            </>
          )}
          {canEdit && (
            <Popover open={linkOpen} onOpenChange={setLinkOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="xs"
                    className="gap-1 font-normal normal-case tracking-normal text-muted-foreground"
                  />
                }
              >
                <Link2 className="size-3" /> Связать существующую
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-2.5">
                <TaskSearchField
                  excludeIds={linkExcludeIds}
                  placeholder="Какую задачу подчинить?"
                  onPick={async (hit) => {
                    // Прежняя связь рвётся молча — из этого списка её не видно,
                    // а тот, кто её строил, узнает об этом последним.
                    if (
                      hit.has_parent &&
                      !window.confirm(
                        `Задача «${hit.title}» уже подчинена другой. Переподчинить её этой?`,
                      )
                    ) {
                      return;
                    }
                    await onLinkExisting(hit);
                    setLinkOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          )}
        </span>
      </div>
      <div className={cn("flex select-none flex-col gap-0.5", !drag.idle && "cursor-grabbing")}>
        {shown.map((s, i) => (
          <SubtaskRow
            key={s.id}
            sub={s}
            index={i}
            canEdit={canEdit}
            drag={canDrag ? drag : null}
            chainProjectIds={chainProjectIds}
            onToggleDone={onToggleDone}
            onOpen={onOpen}
            onPatch={onPatch}
            onDelete={onDelete}
            onDetach={onDetach}
          />
        ))}
        {shown.length === 0 && subtasks.length > 0 && (
          <p className="px-1 py-1.5 text-xs text-muted-foreground">Под фильтр не попала ни одна подзадача.</p>
        )}
        {canEdit && <SubtaskComposer defaults={defaults} onCreate={onCreate} />}
      </div>
    </div>
  );
}

// --- Настройки секции ---------------------------------------------------------------

const MENU_ITEM =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted";

/** Кнопка в шапке секции: тот же размер, что и чипы строки. */
const HEAD_BUTTON =
  "flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-normal normal-case tracking-normal " +
  "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

function SubtaskSortMenu() {
  const sort = useSubtaskViewStore((s) => s.sort);
  const direction = useSubtaskViewStore((s) => s.direction);
  const setSort = useSubtaskViewStore((s) => s.setSort);
  const setDirection = useSubtaskViewStore((s) => s.setDirection);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(HEAD_BUTTON, sort !== "manual" && "text-foreground")}
            title="Порядок подзадач"
          />
        }
      >
        <ArrowUpDown className="size-3.5" />
        {SUBTASK_SORT_LABELS[sort]}
      </PopoverTrigger>
      <PopoverContent align="end" className={MENU_POPOVER}>
        {SUBTASK_SORT_COLUMNS.map((column) => (
          <button key={column} onClick={() => setSort(column)} className={MENU_ITEM}>
            <span className="flex-1">{SUBTASK_SORT_LABELS[column]}</span>
            {sort === column && <Check className="size-3.5" />}
          </button>
        ))}
        {/* У ручного порядка направления нет: он и есть направление. */}
        {sort !== "manual" && (
          <div className="mt-1 flex gap-1 border-t border-border pt-1">
            {(["asc", "desc"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setDirection(value)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted",
                  direction === value ? "bg-muted text-foreground" : "text-muted-foreground",
                )}
              >
                {value === "asc" ? <ArrowUpNarrowWide className="size-3.5" /> : <ArrowDownWideNarrow className="size-3.5" />}
                {value === "asc" ? "По возрастанию" : "По убыванию"}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Фильтр собирается из значений самой ветки, а не из справочников организации:
 * десять статусов и весь состав команды в карточке — это список, по которому
 * ничего не найти, и половина чипов там всё равно не дала бы ни одной строки.
 */
function SubtaskFilterMenu({ subtasks }: { subtasks: TaskListItem[] }) {
  const statuses = useV2Store((s) => s.statuses);
  const filters = useSubtaskViewStore((s) => s.filters);
  const toggleFilterValue = useSubtaskViewStore((s) => s.toggleFilterValue);
  const togglePriority = useSubtaskViewStore((s) => s.togglePriority);
  const setHideDone = useSubtaskViewStore((s) => s.setHideDone);
  const resetFilters = useSubtaskViewStore((s) => s.resetFilters);
  const active = subtaskFiltersActive(filters);

  const statusOptions = useMemo(() => {
    const used = new Set(subtasks.map((s) => s.status_id).filter((id): id is string => !!id));
    return statuses.filter((s) => used.has(s.id));
  }, [subtasks, statuses]);

  const assigneeOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const s of subtasks) {
      for (const a of s.assignees) map.set(a.id, { id: a.id, name: a.name || a.email });
    }
    return [...map.values()];
  }, [subtasks]);

  const hasUnassigned = subtasks.some((s) => s.assignees.length === 0);
  const priorityOptions = useMemo(() => {
    const used = new Set(subtasks.map((s) => s.priority));
    return (Object.keys(PRIORITY_LABELS) as TaskPriority[]).filter((p) => p !== "none" && used.has(p));
  }, [subtasks]);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(HEAD_BUTTON, "relative px-1", active && "text-foreground")}
            title="Фильтр подзадач"
            aria-label="Фильтр подзадач"
          />
        }
      >
        <Filter className="size-3.5" />
        {active && <span className="absolute right-0 top-0 size-1.5 rounded-full bg-primary" />}
      </PopoverTrigger>
      <PopoverContent align="end" className={WIDE_MENU_POPOVER}>
        {statusOptions.length > 0 && (
          <FilterChipRow label="Статус">
            {statusOptions.map((s) => (
              <FilterChip
                key={s.id}
                active={filters.statusIds.includes(s.id)}
                color={s.color}
                onClick={() => toggleFilterValue("statusIds", s.id)}
              >
                {s.name}
              </FilterChip>
            ))}
          </FilterChipRow>
        )}

        {(assigneeOptions.length > 0 || hasUnassigned) && (
          <FilterChipRow label="Исполнитель">
            {assigneeOptions.map((a) => (
              <FilterChip
                key={a.id}
                active={filters.assigneeIds.includes(a.id)}
                onClick={() => toggleFilterValue("assigneeIds", a.id)}
              >
                {a.name}
              </FilterChip>
            ))}
            {hasUnassigned && (
              <FilterChip
                active={filters.assigneeIds.includes(NONE_VALUE)}
                onClick={() => toggleFilterValue("assigneeIds", NONE_VALUE)}
              >
                Без исполнителя
              </FilterChip>
            )}
          </FilterChipRow>
        )}

        {priorityOptions.length > 0 && (
          <FilterChipRow label="Приоритет">
            {priorityOptions.map((p) => (
              <FilterChip
                key={p}
                active={filters.priorities.includes(p)}
                onClick={() => togglePriority(p)}
              >
                <PriorityDot priority={p} />
                {PRIORITY_LABELS[p].label}
              </FilterChip>
            ))}
          </FilterChipRow>
        )}

        <div className="mt-1 flex items-center gap-2 border-t border-border pt-1.5">
          <button onClick={() => setHideDone(!filters.hideDone)} className={cn(MENU_ITEM, "flex-1 py-1")}>
            <span className="flex-1">Скрывать завершённые</span>
            {filters.hideDone ? <Check className="size-3.5" /> : <Square className="size-3.5 opacity-40" />}
          </button>
          {active && (
            <button
              onClick={resetFilters}
              className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Сбросить
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      <p className="mb-1 px-1 text-[11px] text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FilterChip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={active && color ? chipStyle(color) : undefined}
      className={cn(
        "flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] transition-colors",
        active
          ? color
            ? "tinted-chip"
            : "bg-primary text-primary-foreground"
          : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <span className="truncate">{children}</span>
    </button>
  );
}

// --- Строка подзадачи ---------------------------------------------------------------

function SubtaskRow({
  sub,
  index,
  canEdit,
  drag,
  chainProjectIds,
  onToggleDone,
  onOpen,
  onPatch,
  onDelete,
  onDetach,
}: {
  sub: TaskListItem;
  index: number;
  canEdit: boolean;
  /** Жест перетаскивания или `null`, если порядок сейчас задаёт не рука. */
  drag: RowDragApi | null;
  /** Проекты цепочки родителя — см. `projectIds` ниже. */
  chainProjectIds: string[];
  onToggleDone: (sub: TaskListItem) => void;
  onOpen: (taskId: string) => void;
  onPatch: (sub: TaskListItem, body: Record<string, unknown>) => void;
  onDelete: (sub: TaskListItem) => void;
  onDetach: (sub: TaskListItem) => void;
}) {
  const isDone = !!sub.completed_at;
  const due = formatDue(sub.due_date, sub.due_time);

  // Состав исполнителей закрытого проекта сервер сужает по всей цепочке
  // (`access.chainProjectIds`), а собственных размещений у подзадачи может не
  // быть вовсе. По одним её `placements` список вышел бы на всю организацию —
  // и сохранение закончилось бы отказом.
  const projectIds = useMemo(
    () => Array.from(new Set([...sub.placements.map((p) => p.project_id), ...chainProjectIds])),
    [sub.placements, chainProjectIds],
  );

  const mark = isDone ? (
    <CheckCircle2 className="size-4 text-emerald-500" />
  ) : (
    <Circle className="size-4 text-muted-foreground" />
  );

  const dragging = drag?.draggingId === sub.id;

  return (
    <div
      style={drag ? { transform: `translate3d(0, ${drag.shiftOf(index)}px, 0)`, zIndex: dragging ? 10 : undefined } : undefined}
      className={cn(
        "group/sub relative flex items-center gap-0.5 rounded-md px-1 py-0.5",
        (!drag || drag.idle) && "hover:bg-muted/50",
        dragging && "bg-background shadow-md ring-1 ring-ring",
        // Переход живёт только на время жеста: оставленный включённым, он
        // проигрывает возврат из уже применённого сдвига — то есть рывок.
        drag && !drag.idle && !dragging && "pointer-events-none transition-transform duration-150 ease-out",
      )}
    >
      {/* Ручка занимает место только когда порядок и правда ручной: в остальных
          режимах строка не должна ехать вправо ради кнопки, которой нет. */}
      {drag && (
        <button
          {...drag.handlers(index, sub.id)}
          // touch-none обязателен: без него палец на телефоне прокручивает
          // карточку вместо перетаскивания.
          className={cn(
            "shrink-0 touch-none rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground",
            dragging ? "cursor-grabbing" : "cursor-grab",
            !dragging && CHIP_ON_HOVER,
          )}
          title="Перетащите, чтобы изменить порядок (или ↑/↓)"
          aria-label={`Переместить подзадачу «${sub.title}»`}
        >
          <GripVertical className="size-3.5" />
        </button>
      )}
      {/* Гостю кружок не кликабелен: сервер такую правку всё равно отвергнет. */}
      {canEdit ? (
        <button
          onClick={() => onToggleDone(sub)}
          title={isDone ? "Вернуть в работу" : "Завершить"}
          className="shrink-0"
        >
          {mark}
        </button>
      ) : (
        <span className="shrink-0" title={isDone ? "Завершена" : "В работе"}>
          {mark}
        </span>
      )}
      {/* Название открывает карточку подзадачи: она такая же задача, и все её
          поля правятся там же, где у обычной. */}
      <button
        onClick={() => onOpen(sub.id)}
        className={cn(
          "mx-1 min-w-0 flex-1 truncate py-0.5 text-left text-sm hover:underline",
          isDone && "text-muted-foreground line-through",
        )}
        title={sub.title}
      >
        {sub.title}
      </button>

      {/* Те же параметры, что задаются в момент создания подзадачи. Проекты,
          теги и кастомные поля сюда не выносим: они и в строке создания спрятаны
          под «развернуть», а правятся отдельными эндпоинтами. */}
      {canEdit ? (
        <>
          <PriorityChip
            value={sub.priority}
            onChange={(priority) => onPatch(sub, { priority })}
            className={sub.priority === "none" ? CHIP_ON_HOVER : undefined}
          />
          <StatusChip
            value={sub.status_id}
            onChange={(status_id) => onPatch(sub, { status_id })}
            className={cn("max-w-28", !sub.status_id && CHIP_ON_HOVER)}
          />
          <AssigneesChip
            value={sub.assignees.map((a) => a.id)}
            projectIds={projectIds}
            onChange={(assignee_ids) => onPatch(sub, { assignee_ids })}
            className={sub.assignees.length === 0 ? CHIP_ON_HOVER : undefined}
          />
          <DueChip
            date={sub.due_date}
            time={sub.due_time}
            done={isDone}
            onChange={(next) => onPatch(sub, next)}
            className={sub.due_date ? undefined : CHIP_ON_HOVER}
          />
          <EstimateChip
            value={sub.estimated_minutes}
            onChange={(estimated_minutes) => onPatch(sub, { estimated_minutes })}
            className={sub.estimated_minutes == null ? CHIP_ON_HOVER : undefined}
          />
        </>
      ) : (
        <>
          {sub.priority !== "none" && (
            <span title={PRIORITY_LABELS[sub.priority].label}>
              <PriorityDot priority={sub.priority} />
            </span>
          )}
          {due && (
            <span
              className={cn("shrink-0 px-1 text-[11px] tabular-nums", dueTone(sub.due_date, isDone))}
            >
              {due}
            </span>
          )}
          {sub.assignees.length > 0 && <AvatarStack users={sub.assignees} max={2} />}
        </>
      )}
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Действия"
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => onOpen(sub.id)}>Открыть карточку</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDetach(sub)}>
              <Unlink className="size-3.5" /> Сделать самостоятельной
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(sub)}>
              <Trash2 className="size-3.5" /> Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// --- Строка добавления --------------------------------------------------------------

function SubtaskComposer({
  defaults,
  onCreate,
}: {
  defaults: Partial<TaskDraft>;
  onCreate: (draft: TaskDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(defaults));
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Описание отдаётся редактором по blur: клик по «Сохранить» сначала снимает
  // с него фокус, и обработчик видел бы черновик прошлого рендера.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const patch = useCallback((change: Partial<TaskDraft>) => {
    setDraft((prev) => ({ ...prev, ...change }));
  }, []);

  const reset = useCallback(() => {
    setDraft(emptyDraft(defaults));
    setError(null);
  }, [defaults]);

  const save = useCallback(async () => {
    const current = draftRef.current;
    if (!current.title.trim() || saving) return;
    setSaving(true);
    try {
      await onCreate(current);
      setDraft(emptyDraft(defaults));
      setError(null);
      titleRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать подзадачу");
    } finally {
      setSaving(false);
    }
  }, [onCreate, saving, defaults]);

  const filled = isDraftFilled(draft, defaults);

  return (
    <div className="mt-1 rounded-md border border-dashed border-border">
      {/* flex-wrap: на телефоне чипы уезжают на вторую строку, а не сжимают
          поле названия до нечитаемой ширины. */}
      <div className="flex flex-wrap items-center gap-0.5 px-1 py-1">
        <Plus className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={titleRef}
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              reset();
            }
          }}
          placeholder="Новая подзадача…"
          className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        <PriorityChip value={draft.priority} onChange={(priority) => patch({ priority })} />
        <StatusChip value={draft.status_id} onChange={(status_id) => patch({ status_id })} />
        <AssigneesChip
          value={draft.assignee_ids}
          projectIds={draft.project_ids}
          onChange={(assignee_ids) => patch({ assignee_ids })}
        />
        <DueChip date={draft.due_date} time={draft.due_time} onChange={(next) => patch(next)} />
        <EstimateChip
          value={draft.estimated_minutes}
          onChange={(estimated_minutes) => patch({ estimated_minutes })}
        />
        <button
          onClick={() => setExpanded((v) => !v)}
          className={cn(CHIP, CHIP_EMPTY)}
          title={expanded ? "Свернуть поля" : "Развернуть: описание, теги, проекты"}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
      </div>

      {expanded && <SubtaskDraftDetails draft={draft} patch={patch} />}

      {(filled || expanded) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-2 py-1.5">
          <Button size="xs" onClick={() => void save()} disabled={saving || !draft.title.trim()}>
            {saving ? "Сохранение…" : "Добавить"}
          </Button>
          {filled && (
            <Button variant="ghost" size="xs" className="gap-1" onClick={reset} disabled={saving}>
              <RotateCcw className="size-3" />
              Очистить
            </Button>
          )}
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      )}
    </div>
  );
}

/** Поля, которым тесно в строке: описание, теги, проекты, кастомные поля. */
function SubtaskDraftDetails({ draft, patch }: DraftProps) {
  const fields = useV2Store((s) => s.fields);
  const tags = useV2Store((s) => s.tags);
  const projects = useV2Store((s) => s.projects);
  // Поле проекта показываем, только если задача в этот проект и правда попадёт.
  const visibleFields = fields.filter(
    (f) => !f.project_id || draft.project_ids.includes(f.project_id),
  );
  const selectedTags = tags.filter((t) => draft.tag_ids.includes(t.id));

  return (
    <div className="flex flex-col gap-2 border-t border-border px-2 py-2">
      <div className="grid grid-cols-[76px_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">Проекты</span>
        <Popover>
          <PopoverTrigger render={<button className={cn(CHIP, "w-full justify-start gap-1")} />}>
            {draft.project_ids.length === 0 ? (
              <span className={CHIP_EMPTY}>Личная подзадача</span>
            ) : (
              draft.project_ids.map((id) => {
                const project = projects.find((p) => p.id === id);
                return (
                  <span
                    key={id}
                    className="tinted-chip inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5"
                    style={chipStyle(project?.color)}
                  >
                    <span className="truncate">{project?.name ?? "—"}</span>
                  </span>
                );
              })
            )}
          </PopoverTrigger>
          <PopoverContent align="start" className={WIDE_MENU_POPOVER}>
            <ProjectsMenu value={draft.project_ids} onChange={(project_ids) => patch({ project_ids })} />
          </PopoverContent>
        </Popover>

        <span className="text-muted-foreground">Теги</span>
        <Popover>
          <PopoverTrigger render={<button className={cn(CHIP, "w-full justify-start gap-1")} />}>
            {selectedTags.length === 0 ? (
              <span className={CHIP_EMPTY}>Не выбраны</span>
            ) : (
              selectedTags.map((t) => (
                <span
                  key={t.id}
                  className="tinted-chip truncate rounded px-1.5 py-0.5 text-[11px]"
                  style={chipStyle(t.color)}
                >
                  {t.name}
                </span>
              ))
            )}
          </PopoverTrigger>
          <PopoverContent align="start" className={MENU_POPOVER}>
            <TagsMenu value={draft.tag_ids} onChange={(tag_ids) => patch({ tag_ids })} />
          </PopoverContent>
        </Popover>

        {visibleFields.map((f) => (
          <CustomFieldChip key={f.id} field={f} draft={draft} patch={patch} />
        ))}
      </div>

      <RichText
        value={draft.description}
        onSave={(html) => patch({ description: html })}
        placeholder="Описание подзадачи…"
      />
    </div>
  );
}

// --- Чипы редакторов ----------------------------------------------------------------

// Чипы работают парой {value, onChange}, а не черновиком целиком: те же самые
// контролы обслуживают и строку создания, и строку существующей подзадачи —
// у второй никакого `TaskDraft` нет, есть задача и PATCH.

interface DraftProps {
  draft: TaskDraft;
  patch: (change: Partial<TaskDraft>) => void;
}

function PriorityChip({
  value,
  onChange,
  className,
}: {
  value: TaskPriority;
  onChange: (priority: TaskPriority) => void;
  className?: string;
}) {
  const set = value !== "none";
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(CHIP, set ? CHIP_SET : CHIP_EMPTY, className)}
            title={`Приоритет: ${PRIORITY_LABELS[value].label}`}
          />
        }
      >
        {set ? (
          <PriorityDot priority={value} />
        ) : (
          <span className="size-2 rounded-full border border-dashed border-muted-foreground/60" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={PRIORITY_POPOVER}>
        <PriorityMenu value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

function StatusChip({
  value,
  onChange,
  className,
}: {
  value: string | null;
  onChange: (statusId: string | null) => void;
  className?: string;
}) {
  const statuses = useV2Store((s) => s.statuses);
  // Пока статус не выбран, показываем тот, с которым подзадача родится, —
  // иначе чип врёт про будущий результат.
  const status = statuses.find((s) => s.id === value) ?? defaultStatus(statuses);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(CHIP, "max-w-32", status ? CHIP_SET : CHIP_EMPTY, className)}
            title={status ? `Статус: ${status.name}` : "Статус"}
          />
        }
      >
        {status ? (
          <span
            className="tinted-chip inline-flex max-w-full items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-[11px] font-medium"
            style={chipStyle(status.color)}
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
            <span className="truncate">{status.name}</span>
          </span>
        ) : (
          <span className="size-2 rounded-full border border-dashed border-muted-foreground/60" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={MENU_POPOVER}>
        <StatusMenu value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

function AssigneesChip({
  value,
  projectIds,
  onChange,
  className,
}: {
  value: string[];
  projectIds: string[];
  onChange: (userIds: string[]) => void;
  className?: string;
}) {
  const members = useV2Store((s) => s.members);
  const selected = members.filter((m) => value.includes(m.user_id));
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(CHIP, selected.length > 0 ? CHIP_SET : CHIP_EMPTY, className)}
            title="Исполнители"
          />
        }
      >
        {selected.length > 0 ? (
          <AvatarStack
            users={selected.map((m) => ({
              id: m.user_id,
              email: m.email,
              name: m.name,
              avatar_url: m.avatar_url,
            }))}
            max={2}
          />
        ) : (
          <UserPlus className="size-3.5" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={WIDE_MENU_POPOVER}>
        <AssigneesMenu value={value} projectIds={projectIds} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

function DueChip({
  date,
  time,
  done = false,
  onChange,
  className,
}: {
  date: string | null;
  time: string | null;
  /** Просроченный срок у завершённой задачи красным не подсвечиваем. */
  done?: boolean;
  onChange: (next: { due_date: string | null; due_time: string | null }) => void;
  className?: string;
}) {
  const text = formatDue(date, time);
  return (
    <DuePicker
      date={date}
      time={time}
      triggerClassName={cn(CHIP, text ? CHIP_SET : CHIP_EMPTY, className)}
      onCommit={onChange}
    >
      {/* Подпись на самом триггере: DuePicker пробрасывает наружу только класс. */}
      {text ? (
        <span className={cn("tabular-nums", dueTone(date, done))} title="Срок">
          {text}
        </span>
      ) : (
        <CalendarDays className="size-3.5" aria-label="Срок" />
      )}
    </DuePicker>
  );
}

function EstimateChip({
  value,
  onChange,
  className,
}: {
  value: number | null;
  onChange: (minutes: number | null) => void;
  className?: string;
}) {
  const set = value != null;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button className={cn(CHIP, set ? CHIP_SET : CHIP_EMPTY, className)} title="Оценка" />
        }
      >
        {set ? (
          <span className="tabular-nums">{formatEstimate(value)}</span>
        ) : (
          <Clock className="size-3.5" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={ESTIMATE_POPOVER}>
        <EstimateForm value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

function CustomFieldChip({ field, draft, patch }: DraftProps & { field: CustomField }) {
  const text = describeFieldValue(field, draft.field_values[field.id]);
  return (
    <>
      <span className="truncate text-muted-foreground" title={field.name}>
        {field.name}
      </span>
      <Popover>
        <PopoverTrigger
          render={<button className={cn(CHIP, "w-full justify-start", text ? CHIP_SET : CHIP_EMPTY)} />}
        >
          <span className="truncate">{text || "Не задано"}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className={FIELD_POPOVER}>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {field.name}
          </span>
          <DraftFieldControl
            field={field}
            value={draft.field_values[field.id]}
            onChange={(value) => patch({ field_values: { ...draft.field_values, [field.id]: value } })}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
