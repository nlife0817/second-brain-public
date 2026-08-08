"use client";

// Календарь задач: месяц, неделя и день. Четвёртый вид рядом с таблицей, доской
// и гантом — данные, фильтры и поиск у них общие (`ViewStore`), поэтому один и
// тот же срез виден во всех четырёх одинаково.
//
// Раскладка и математика жестов живут в `lib/core/calendar.ts` и покрыты
// тестами; здесь — отрисовка, прокрутка, указатель и клавиатура.
//
// Что легко сломать обратной правкой:
//
//  1. **Полотно не ходит на сервер за навигацию.** Задачи приезжают один раз
//     (как в таблице и ганте) и фильтруются на клиенте, поэтому листание
//     месяцев мгновенно. Плата та же, что у таблицы: список ограничен
//     `ALL_TASKS_CAP`, а завершённые приходят только по «Готово = Показать».
//  2. **Внешние события — отдельный слой и отдельный запрос**, привязанный к
//     окну (`from`/`to`). Они принадлежат пользователю, а не организации, и в
//     задачи не превращаются: правки у них нет по построению (`editable`).
//  3. **Предсказание жеста считается той же функцией, что и патч.** Полоса под
//     курсором рисуется из `taskItem({...task, ...dragItem(...)})` — то есть из
//     будущего состояния задачи, а не из отдельной «визуальной» математики.
//     Разъедутся они — полоса прыгнет в момент отпускания.
//  4. **Живое состояние жеста дублируется в ref.** События указателя приходят
//     пачками, и замыкание рендера теряет те, что пришли до перерисовки, — та
//     же причина, что в ганте и в перетаскивании колонок. Слушатели `pointermove`
//     и `pointerup` висят на окне: жест обязан продолжаться, когда курсор ушёл
//     с полотна, и заканчиваться, когда его отпустили за пределами окна.
//  5. **Геометрия считается от элемента с полным содержимым, а не от области
//     прокрутки.** Ref стоит на внутреннем полотне: его прямоугольник едет
//     вместе с прокруткой, и «день под курсором» остаётся верным на любом
//     смещении. Ref на скроллере давал бы верный ответ только в самом верху.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Link2,
  Loader2,
  MapPin,
  Settings,
  X,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PriorityDot, chipStyle } from "@/components/v2/bits";
import { CALENDAR_SECTIONS, ViewSettingsPopover } from "@/components/v2/tasks/ViewControls";
import { FilterButton, TaskCount, TaskSearch } from "@/components/v2/tasks/ViewToolbar";
import {
  CALENDAR_SCALE_LABELS,
  MINUTES_IN_DAY,
  SNAP_MINUTES,
  calendarRange,
  dragItem,
  eventItem,
  itemTimeLabel,
  itemsInRange,
  laneCount,
  layoutBars,
  layoutDay,
  rangeTitle,
  shiftAnchor,
  slotDraft,
  snapMinutes,
  taskItem,
  weeksOf,
  type CalendarDragKind,
  type CalendarItem,
  type CalendarScale,
  type DayRange,
  type TaskDatesPatch,
} from "@/lib/core/calendar";
import { api } from "@/lib/core/client";
import {
  MONTHS_OF,
  WEEKDAYS_SHORT,
  dayOfMonth,
  daysOf,
  isWeekend,
  monthIndex,
  weekday,
} from "@/lib/core/days";
import { invalidate } from "@/lib/core/query";
import { emptyDraft, type TaskDraft } from "@/lib/core/task-draft";
import { useExternalCalendars } from "@/lib/core/use-external-calendars";
import type {
  CalendarAccountWithCalendars,
  CalendarBrief,
  CalendarEventRow,
  TaskDetail,
  TaskRow,
} from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { useViewStore } from "@/lib/core/view-store";
import { filterTasks, makeMatchContext, todayIso, visiblePool } from "@/lib/core/views";
import { cn } from "@/lib/utils";

/** Высота часа в сетке недели и дня. Меньше — подписи времени не читаются. */
const HOUR_H = 48;
/** Высота плашки и зазор между дорожками. */
const CHIP_H = 20;
const CHIP_GAP = 2;
const LANE_H = CHIP_H + CHIP_GAP;
/** Сколько дорожек показывает клетка месяца, включая строку «ещё N». */
const MONTH_LANES = 5;
/** Сколько дорожек показывает полоса «весь день» до собственной прокрутки. */
const ALLDAY_LANES = 3;
/** Место под число дня в клетке месяца. */
const DAY_NUM_H = 22;
/** Ширина колонки с часами. */
const GUTTER_W = 52;
/** Смещение указателя, до которого жест считается кликом, а не перетаскиванием. */
const CLICK_SLOP = 4;
/** Куда прокручена часовая сетка при открытии: рабочий день, а не полночь. */
const DEFAULT_SCROLL_HOUR = 7;
/** Как часто переставляется линия текущего времени. */
const NOW_TICK_MS = 60_000;

const DEFAULT_EVENT_COLOR = "#7c8ba1";

export interface CalendarViewProps {
  tasks: TaskRow[];
  setTasks: Dispatch<SetStateAction<TaskRow[]>>;
  /** Ключ клиентского кэша, который надо сбросить после правки. */
  invalidateKey: string | null;
  reload: () => Promise<void> | void;
  loading?: boolean;
  error?: string | null;
  onDismissError?: () => void;
  onOpenTask: (id: string) => void;
  /** Без него полотно только читает: создание кликом по слоту недоступно. */
  onCreateTask?: (draft: TaskDraft) => Promise<void>;
  draftDefaults?: Partial<TaskDraft>;
  titleSlot?: ReactNode;
  actionsSlot?: ReactNode;
  emptyText?: string;
}

/** Живой жест: перетаскивание элемента или выделение пустого слота. */
type Gesture =
  | {
      type: "item";
      kind: CalendarDragKind;
      item: CalendarItem;
      days: number;
      minutes: number;
      moved: boolean;
    }
  | {
      type: "create";
      /** Где нажали и где указатель сейчас — слот считается по паре. */
      fromDay: string;
      toDay: string;
      fromMinutes: number | null;
      toMinutes: number | null;
      moved: boolean;
    };

/** Обстановка жеста, снятая на его старте: масштаб посреди жеста не меняется. */
interface GestureFrame {
  rect: DOMRect;
  days: string[];
  columns: number;
  /** Есть ли в этой области часовая сетка. */
  timed: boolean;
  startX: number;
  startY: number;
}

/** Указатель: и React-событие, и нативное подходят под одну форму. */
interface PointerLike {
  clientX: number;
  clientY: number;
}

export function CalendarView({
  tasks,
  setTasks,
  invalidateKey,
  reload,
  loading = false,
  error: externalError = null,
  onDismissError,
  onOpenTask,
  onCreateTask,
  draftDefaults,
  titleSlot,
  actionsSlot,
  emptyText = "Задач с датами нет.",
}: CalendarViewProps) {
  const { orgId, statuses, fields, me, orgRole } = useV2Store();
  const canEdit = orgRole !== "guest" && orgRole !== null;

  const filterGroups = useViewStore((s) => s.groups);
  const search = useViewStore((s) => s.search);
  const scale = useViewStore((s) => s.calendarScale);
  const setScale = useViewStore((s) => s.setCalendarScale);

  // Сегодня считается один раз на монтирование: пересчёт в рендере дал бы новую
  // ссылку на каждую перерисовку и «дрожащую» подсветку текущего дня.
  const today = useMemo(() => todayIso(), []);
  const [anchor, setAnchor] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);

  const range = useMemo(() => calendarRange(anchor, scale), [anchor, scale]);

  // --- Задачи ------------------------------------------------------------------------

  const matchCtx = useMemo(() => makeMatchContext(me?.id ?? null), [me?.id]);
  const pool = useMemo(() => visiblePool(tasks, filterGroups, statuses), [tasks, filterGroups, statuses]);
  const visibleTasks = useMemo(
    () => filterTasks(pool, filterGroups, search, matchCtx),
    [pool, filterGroups, search, matchCtx],
  );

  const statusColor = useMemo(() => new Map(statuses.map((s) => [s.id, s.color])), [statuses]);
  const colorOf = useCallback(
    (task: TaskRow) => (task.status_id ? (statusColor.get(task.status_id) ?? null) : null),
    [statusColor],
  );

  const taskItems = useMemo(() => {
    const out: CalendarItem[] = [];
    for (const task of visibleTasks) {
      const item = taskItem(task, today, colorOf(task));
      if (item) out.push(item);
    }
    return out;
  }, [visibleTasks, today, colorOf]);

  /** Задачи без дат: на полотне им места нет, но и терять их нельзя. */
  const undated = useMemo(() => visibleTasks.filter((t) => !t.start_date && !t.due_date), [visibleTasks]);

  // --- Внешние календари ---------------------------------------------------------------

  const { accounts, setAccounts, events, externalError: extError } = useExternalCalendars(range);

  const calendarById = useMemo(() => {
    const map = new Map<string, CalendarBrief>();
    for (const account of accounts) for (const cal of account.calendars) map.set(cal.id, cal);
    return map;
  }, [accounts]);

  const eventItems = useMemo(() => {
    const out: CalendarItem[] = [];
    for (const event of events) {
      const cal = calendarById.get(event.calendar_id);
      // Скрытый календарь и отменённое событие на полотно не попадают: галочка
      // видимости обязана убирать события немедленно, не дожидаясь синка.
      if (cal && !cal.visible) continue;
      if (event.status === "cancelled") continue;
      const item = eventItem(event, cal?.color_override ?? cal?.color ?? DEFAULT_EVENT_COLOR);
      if (item) out.push(item);
    }
    return out;
  }, [events, calendarById]);

  const eventById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  // --- Правка ------------------------------------------------------------------------

  // Зеркало списка для обработчиков: побочный эффект внутри апдейтера состояния
  // выполнился бы столько раз, сколько React решит прогнать обновление, а
  // `tasks` в зависимостях пересоздавал бы обработчики на каждую правку списка.
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const patchTask = useCallback(
    async (taskId: string, payload: TaskDatesPatch) => {
      if (!orgId || Object.keys(payload).length === 0) return;
      const before = tasksRef.current.find((t) => t.id === taskId);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...payload } : t)));
      try {
        const updated = await api.patch<TaskDetail>(`/orgs/${orgId}/tasks/${taskId}`, payload);
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  start_date: updated.start_date,
                  start_time: updated.start_time,
                  due_date: updated.due_date,
                  due_time: updated.due_time,
                  updated_at: updated.updated_at,
                }
              : t,
          ),
        );
        setError(null);
        // Экран верен, а в кэше лежит расклад до правки: без сброса возврат на
        // экран показал бы прежние даты.
        if (invalidateKey) invalidate(invalidateKey);
      } catch (e) {
        // Откат: интерфейс, который врёт после отказа сети, хуже отсутствия
        // оптимизма — человек уверен, что задача переехала.
        if (before) setTasks((prev) => prev.map((t) => (t.id === taskId ? before : t)));
        setError(e instanceof Error ? e.message : "Не удалось сохранить даты");
      }
    },
    [orgId, setTasks, invalidateKey],
  );

  // --- Жесты ------------------------------------------------------------------------

  const frameRef = useRef<GestureFrame | null>(null);
  const gestureRef = useRef<Gesture | null>(null);

  const setBoth = useCallback((next: Gesture | null) => {
    gestureRef.current = next;
    setGesture(next);
  }, []);

  /** Точка полотна под указателем. Считается по геометрии сетки: колонки равны. */
  const pointAt = useCallback((e: PointerLike, frame: GestureFrame) => {
    const { rect, days, columns, timed } = frame;
    const colW = rect.width / columns;
    const col = Math.min(columns - 1, Math.max(0, Math.floor((e.clientX - rect.left) / colW)));
    if (timed) {
      const minutes = ((e.clientY - rect.top) / HOUR_H) * 60;
      return { day: days[col] ?? days[0], minutes: Math.min(MINUTES_IN_DAY, Math.max(0, minutes)) };
    }
    // Месяц: строки недель равной высоты, поэтому день — это (строка × 7 + столбец).
    const rows = Math.max(1, Math.round(days.length / columns));
    const rowH = rect.height / rows;
    const row = Math.min(rows - 1, Math.max(0, Math.floor((e.clientY - rect.top) / rowH)));
    return { day: days[row * columns + col] ?? days[0], minutes: null as number | null };
  }, []);

  const startItemGesture = useCallback(
    (e: React.PointerEvent, item: CalendarItem, kind: CalendarDragKind, frame: GestureFrame) => {
      frameRef.current = frame;
      setBoth({ type: "item", kind, item, days: 0, minutes: 0, moved: false });
      e.preventDefault();
    },
    [setBoth],
  );

  const startCreateGesture = useCallback(
    (e: React.PointerEvent, frame: GestureFrame) => {
      const point = pointAt(e, frame);
      frameRef.current = frame;
      const minutes = point.minutes == null ? null : snapMinutes(point.minutes);
      setBoth({
        type: "create",
        fromDay: point.day,
        toDay: point.day,
        fromMinutes: minutes,
        toMinutes: minutes,
        moved: false,
      });
      e.preventDefault();
    },
    [pointAt, setBoth],
  );

  const handleMove = useCallback(
    (e: PointerLike) => {
      const active = gestureRef.current;
      const frame = frameRef.current;
      if (!active || !frame) return;

      const dx = e.clientX - frame.startX;
      const dy = e.clientY - frame.startY;
      const moved = active.moved || Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP;

      if (active.type === "item") {
        const colW = frame.rect.width / frame.columns;
        // В месяце вертикаль тоже меняет день: строка вниз — это неделя вперёд.
        const rows = frame.timed ? 1 : Math.max(1, Math.round(frame.days.length / frame.columns));
        const rowH = frame.rect.height / rows;
        const days = Math.round(dx / colW) + (frame.timed ? 0 : Math.round(dy / rowH) * frame.columns);
        const minutes = frame.timed ? snapMinutes((dy / HOUR_H) * 60) : 0;
        if (days === active.days && minutes === active.minutes && moved === active.moved) return;
        setBoth({ ...active, days, minutes, moved });
        return;
      }

      const point = pointAt(e, frame);
      const minutes = point.minutes == null ? null : snapMinutes(point.minutes);
      if (point.day === active.toDay && minutes === active.toMinutes && moved === active.moved) return;
      setBoth({ ...active, toDay: point.day, toMinutes: minutes, moved });
    },
    [pointAt, setBoth],
  );

  const finishGesture = useCallback(() => {
    const active = gestureRef.current;
    frameRef.current = null;
    setBoth(null);
    if (!active) return;

    if (active.type === "item") {
      // Жест без движения — обычный клик: карточку открывает сам чип своим
      // onClick, поэтому здесь делать нечего.
      if (!active.moved) return;
      void patchTask(
        active.item.id,
        dragItem(active.item, active.kind, { days: active.days, minutes: active.minutes }),
      );
      return;
    }

    if (!onCreateTask) return;
    const [fromDay, toDay] =
      active.fromDay <= active.toDay ? [active.fromDay, active.toDay] : [active.toDay, active.fromDay];
    const span =
      active.fromMinutes == null || active.toMinutes == null
        ? null
        : { startMinutes: active.fromMinutes, endMinutes: active.toMinutes };
    const dates = slotDraft(fromDay, span);
    void onCreateTask({
      ...emptyDraft(draftDefaults),
      start_date: dates.start_date ?? null,
      start_time: dates.start_time ?? null,
      // Протяжка по нескольким дням задаёт обе даты: полоса, выделенная на три
      // дня, обязана такой и появиться.
      due_date: span ? (dates.due_date ?? null) : toDay,
      due_time: dates.due_time ?? null,
    });
  }, [onCreateTask, patchTask, setBoth, draftDefaults]);

  // Пока жест жив, указатель слушаем на окне: он уходит и за пределы полотна, и
  // за пределы окна, а брошенный жест оставил бы полосу прилипшей к курсору.
  useEffect(() => {
    if (!gesture) return;
    const move = (e: PointerEvent) => handleMove(e);
    const stop = () => finishGesture();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [gesture, handleMove, finishGesture]);

  /**
   * Элементы с учётом живого жеста: у перетаскиваемой задачи полоса считается из
   * будущего состояния (тот же `dragItem`, что уйдёт в патч) — поэтому в момент
   * отпускания она не прыгает.
   */
  const items = useMemo(() => {
    const all = [...taskItems, ...eventItems];
    if (!gesture || gesture.type !== "item" || !gesture.moved) return all;
    const patch = dragItem(gesture.item, gesture.kind, { days: gesture.days, minutes: gesture.minutes });
    if (Object.keys(patch).length === 0) return all;
    // Список берём прямо из пропа, а не из ref-зеркала: здесь это рендер, и
    // предсказание обязано считаться от того состояния, которое рисуется.
    const task = tasks.find((t) => t.id === gesture.item.id);
    if (!task) return all;
    const preview = taskItem({ ...task, ...patch }, today, colorOf(task));
    return all.map((i) => (i.key === gesture.item.key ? (preview ?? i) : i));
  }, [taskItems, eventItems, gesture, today, colorOf, tasks]);

  const windowItems = useMemo(() => itemsInRange(items, range), [items, range]);

  /** Выделяемый слот рисуется обычной плашкой, чтобы не заводить второй вид. */
  const draftItem = useMemo<CalendarItem | null>(() => {
    if (!gesture || gesture.type !== "create") return null;
    const [fromDay, toDay] =
      gesture.fromDay <= gesture.toDay ? [gesture.fromDay, gesture.toDay] : [gesture.toDay, gesture.fromDay];
    const timed = gesture.fromMinutes != null && gesture.toMinutes != null && fromDay === toDay;
    const from = timed ? Math.min(gesture.fromMinutes!, gesture.toMinutes!) : 0;
    const to = timed ? Math.max(gesture.toMinutes!, from + SNAP_MINUTES) : MINUTES_IN_DAY;
    return {
      key: "__draft__",
      kind: "task",
      id: "__draft__",
      title: "Новая задача",
      bar: !timed,
      timed,
      startDay: fromDay,
      endDay: toDay,
      startMinutes: from,
      endMinutes: to,
      inferredStart: false,
      inferredEnd: false,
      invalid: false,
      color: null,
      done: false,
      overdue: false,
      anchor: "both",
      editable: false,
    };
  }, [gesture]);

  const canvasItems = useMemo(
    () => (draftItem ? [...windowItems, draftItem] : windowItems),
    [windowItems, draftItem],
  );

  // --- Навигация --------------------------------------------------------------------

  const go = useCallback((delta: number) => setAnchor((a) => shiftAnchor(a, scale, delta)), [scale]);
  const goToday = useCallback(() => setAnchor(today), [today]);
  const openDay = useCallback(
    (day: string) => {
      setAnchor(day);
      setScale("day");
    },
    [setScale],
  );

  // Клавиатура как в Google Calendar: стрелки листают, «t» возвращает к
  // сегодняшнему дню, «d/w/m» переключают масштаб. Поля ввода не задеваем —
  // иначе поиск по названию нельзя было бы набрать.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      if (e.key === "ArrowLeft") return go(-1);
      if (e.key === "ArrowRight") return go(1);
      const key = e.key.toLowerCase();
      if (key === "t") return goToday();
      if (key === "d") return setScale("day");
      if (key === "w") return setScale("week");
      if (key === "m") return setScale("month");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, goToday, setScale]);

  const shownError = externalError ?? error ?? extError;

  const gridProps = {
    range,
    items: canvasItems,
    today,
    canEdit: canEdit && !!onCreateTask,
    gesture,
    onStartItem: startItemGesture,
    onStartCreate: startCreateGesture,
    onOpenTask,
    onOpenDay: openDay,
    eventById,
    calendarById,
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        {titleSlot}
        <TaskCount shown={visibleTasks.length} total={pool.length} />
        <TaskSearch />
        <FilterButton />
        <span className="ml-1 flex items-center gap-0.5">
          <button
            onClick={() => go(-1)}
            aria-label="Предыдущий период"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={goToday}
            className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Сегодня
          </button>
          <button
            onClick={() => go(1)}
            aria-label="Следующий период"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </span>
        <span className="text-sm font-medium first-letter:uppercase">{rangeTitle(anchor, scale)}</span>
        <ScaleSwitch scale={scale} onChange={setScale} />
        <span className="flex-1" />
        {actionsSlot}
        {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        <CalendarsPopover accounts={accounts} setAccounts={setAccounts} onError={setError} />
        <ViewSettingsPopover customFields={fields} sections={CALENDAR_SECTIONS} />
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

      {scale === "month" ? <MonthGrid {...gridProps} anchor={anchor} /> : <TimeGrid {...gridProps} />}

      {/* Задачи без дат на сетке показать негде, но и молча прятать их нельзя:
          у ганта для них своя секция, здесь — строка, из которой задачу можно
          открыть и назначить ей день. */}
      {undated.length > 0 && <UndatedStrip tasks={undated} onOpenTask={onOpenTask} />}

      {windowItems.length === 0 && undated.length === 0 && (
        <div className="shrink-0 border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
          {emptyText}
        </div>
      )}
    </div>
  );
}

// --- Внешние календари ------------------------------------------------------------

/** Список подключённых календарей с галочками видимости — как «Мои календари». */
function CalendarsPopover({
  accounts,
  setAccounts,
  onError,
}: {
  accounts: CalendarAccountWithCalendars[];
  setAccounts: Dispatch<SetStateAction<CalendarAccountWithCalendars[]>>;
  onError: (message: string | null) => void;
}) {
  const total = accounts.reduce((n, a) => n + a.calendars.length, 0);

  const toggle = async (cal: CalendarBrief) => {
    const next = !cal.visible;
    // Оптимистично: галочка обязана срабатывать под курсором, а не через сеть.
    const apply = (visible: boolean) =>
      setAccounts((prev) =>
        prev.map((a) => ({
          ...a,
          calendars: a.calendars.map((c) => (c.id === cal.id ? { ...c, visible } : c)),
        })),
      );
    apply(next);
    try {
      await api.patch(`/calendar/calendars/${cal.id}`, { visible: next });
      invalidate("/calendar/accounts");
      onError(null);
    } catch (e) {
      apply(cal.visible);
      onError(e instanceof Error ? e.message : "Не удалось переключить календарь");
    }
  };

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="gap-1.5 text-xs" />}>
        <Link2 className="size-3.5" />
        <span className="hidden sm:inline">Календари</span>
        {total > 0 && (
          <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums">{total}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-2 p-2.5">
        {accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Внешние календари не подключены. Встречи из Google Calendar можно показывать рядом с задачами —
            они останутся только для чтения.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {accounts.map((account) => (
              <div key={account.id} className="flex flex-col gap-1">
                <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {account.label || (account.provider === "google" ? "Google Calendar" : "Подписка ICS")}
                </span>
                {account.sync_error && <span className="text-[11px] text-destructive">{account.sync_error}</span>}
                {account.calendars.map((cal) => (
                  <button
                    key={cal.id}
                    onClick={() => void toggle(cal)}
                    className="flex items-center gap-2 rounded-md px-1 py-1 text-left text-xs transition-colors hover:bg-muted"
                  >
                    <span
                      className={cn(
                        "size-3 shrink-0 rounded-[3px] border",
                        cal.visible ? "border-transparent" : "border-border",
                      )}
                      style={
                        cal.visible
                          ? { backgroundColor: cal.color_override ?? cal.color ?? DEFAULT_EVENT_COLOR }
                          : undefined
                      }
                    />
                    <span className={cn("flex-1 truncate", !cal.visible && "text-muted-foreground")}>
                      {cal.name || "Без названия"}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        <Link
          href="/v2/settings/calendars"
          className="flex items-center gap-1.5 border-t border-border pt-2 text-xs text-primary hover:underline"
        >
          {accounts.length === 0 ? <CalendarPlus className="size-3.5" /> : <Settings className="size-3.5" />}
          {accounts.length === 0 ? "Подключить календарь" : "Настройки календарей"}
        </Link>
      </PopoverContent>
    </Popover>
  );
}

// --- Общие части отрисовки ---------------------------------------------------------

interface GridProps {
  range: DayRange;
  items: CalendarItem[];
  today: string;
  canEdit: boolean;
  gesture: Gesture | null;
  onStartItem: (e: React.PointerEvent, item: CalendarItem, kind: CalendarDragKind, frame: GestureFrame) => void;
  onStartCreate: (e: React.PointerEvent, frame: GestureFrame) => void;
  onOpenTask: (id: string) => void;
  onOpenDay: (day: string) => void;
  eventById: Map<string, CalendarEventRow>;
  calendarById: Map<string, CalendarBrief>;
}

/** Что показать в панели деталей внешнего события. */
interface EventPopup {
  event: CalendarEventRow;
  item: CalendarItem;
  x: number;
  y: number;
}

/** Плашка задачи или события. Одна на все три масштаба — вид задаёт `variant`. */
function Chip({
  item,
  variant,
  style,
  className,
  onOpen,
  onStart,
  onEventClick,
}: {
  item: CalendarItem;
  /** `bar` — полоса по дням, `block` — блок в часовой сетке. */
  variant: "bar" | "block";
  style?: CSSProperties;
  className?: string;
  onOpen: (id: string) => void;
  onStart?: (e: React.PointerEvent, kind: CalendarDragKind) => void;
  onEventClick?: (item: CalendarItem, rect: DOMRect) => void;
}) {
  const draft = item.id === "__draft__";
  const time = itemTimeLabel(item);
  const color = item.color ?? DEFAULT_EVENT_COLOR;

  return (
    <div
      style={{ ...chipStyle(color), ...style }}
      onPointerDown={(e) => {
        if (draft || e.button !== 0) return;
        // Нажатие на плашке не должно доходить до полотна: там оно означало бы
        // «выделяю пустой слот», и клик по событию заводил бы задачу.
        e.stopPropagation();
        onStart?.(e, "move");
      }}
      onClick={(e) => {
        if (draft) return;
        if (item.kind === "event") {
          onEventClick?.(item, (e.currentTarget as HTMLElement).getBoundingClientRect());
          return;
        }
        onOpen(item.id);
      }}
      className={cn(
        "tinted-chip group/chip relative flex min-w-0 select-none overflow-hidden rounded-md px-1.5 text-[11px] leading-none",
        variant === "block"
          ? "flex-col items-start justify-start gap-0.5 py-1 text-left"
          : "items-center gap-1",
        item.done && "opacity-60",
        item.invalid && "ring-1 ring-inset ring-destructive",
        draft && "pointer-events-none border border-dashed border-primary/60",
        onStart ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        className,
      )}
      title={time ? `${item.title} · ${time}` : item.title}
    >
      {/* Цветная метка слева: у события — его календаря, у задачи — статуса. */}
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: color }} />
      <span className={cn("flex min-w-0 items-center gap-1 pl-1", variant === "block" && "w-full")}>
        {item.kind === "event" && <ExternalLink className="size-2.5 shrink-0 opacity-70" />}
        <span className={cn("truncate font-medium", item.done && "line-through")}>{item.title}</span>
      </span>
      {time && (
        <span
          className={cn(
            "shrink-0 pl-1 tabular-nums opacity-80",
            // Выведенный край не должен читаться как заданный.
            (item.inferredEnd || item.inferredStart) && "italic",
          )}
        >
          {time}
        </span>
      )}

      {/* Ручки растягивания: только у своих задач. У внешнего события их нет по
          построению — правки у него не бывает. */}
      {onStart && item.editable && (
        <>
          <span
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              onStart(e, "resize-start");
            }}
            className={cn(
              "absolute opacity-0 group-hover/chip:opacity-100",
              variant === "bar"
                ? "inset-y-0 left-0 w-1.5 cursor-ew-resize"
                : "inset-x-0 top-0 h-1.5 cursor-ns-resize",
            )}
          />
          <span
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              onStart(e, "resize-end");
            }}
            className={cn(
              "absolute opacity-0 group-hover/chip:opacity-100",
              variant === "bar"
                ? "inset-y-0 right-0 w-1.5 cursor-ew-resize"
                : "inset-x-0 bottom-0 h-1.5 cursor-ns-resize",
            )}
          />
        </>
      )}
    </div>
  );
}

/** Панель деталей внешнего события: править его можно только в своём календаре. */
function EventPanel({
  popup,
  calendar,
  onClose,
}: {
  popup: EventPopup;
  calendar: CalendarBrief | undefined;
  onClose: () => void;
}) {
  const { event, item } = popup;
  const time = itemTimeLabel(item);
  const dayLabel = (iso: string) => `${dayOfMonth(iso)} ${MONTHS_OF[monthIndex(iso)]}`;
  const days =
    item.startDay === item.endDay
      ? dayLabel(item.startDay)
      : `${dayLabel(item.startDay)} — ${dayLabel(item.endDay)}`;

  // Панель держится в пределах окна: событие у правого края экрана иначе
  // открывало бы карточку за его границей.
  const left = Math.max(8, Math.min(popup.x, window.innerWidth - 336));
  const top = Math.max(8, Math.min(popup.y, window.innerHeight - 260));

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 flex w-80 flex-col gap-2 rounded-xl border border-border bg-popover p-3 shadow-lg"
        style={{ left, top }}
      >
        <div className="flex items-start gap-2">
          <span
            className="mt-1 size-2.5 shrink-0 rounded-[3px]"
            style={{ backgroundColor: item.color ?? DEFAULT_EVENT_COLOR }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{item.title}</p>
            <p className="text-xs text-muted-foreground">
              {days}
              {time ? `, ${time}` : ", весь день"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {calendar && <p className="truncate text-xs text-muted-foreground">Календарь: {calendar.name}</p>}
        {event.location && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 size-3 shrink-0" />
            <span className="min-w-0 flex-1">{event.location}</span>
          </p>
        )}
        {event.organizer && (
          <p className="truncate text-xs text-muted-foreground">Организатор: {event.organizer}</p>
        )}
        {event.description && (
          // Описание внешнего события — чужой текст: показываем его текстом, а не
          // разметкой, иначе это дверь для чужого HTML на нашем origin.
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {event.description}
          </p>
        )}
        <p className="border-t border-border pt-2 text-[11px] text-muted-foreground">
          Это запись внешнего календаря, а не задача. Изменить её можно там, где она создана.
        </p>
        {event.html_link && (
          <a
            href={event.html_link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" /> Открыть во внешнем календаре
          </a>
        )}
      </div>
    </>
  );
}

/** Строка с задачами без дат — им на сетке места нет. */
function UndatedStrip({ tasks, onOpenTask }: { tasks: TaskRow[]; onOpenTask: (id: string) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-border px-4 py-1.5">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Без даты · {tasks.length}
      </span>
      {tasks.slice(0, 12).map((t) => (
        <button
          key={t.id}
          onClick={() => onOpenTask(t.id)}
          className="flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] transition-colors hover:bg-muted"
        >
          <PriorityDot priority={t.priority} className="size-1.5" />
          <span className="max-w-40 truncate">{t.title}</span>
        </button>
      ))}
      {tasks.length > 12 && (
        <span className="shrink-0 text-[11px] text-muted-foreground">и ещё {tasks.length - 12}</span>
      )}
    </div>
  );
}

// --- Месяц --------------------------------------------------------------------------

function MonthGrid({
  anchor,
  range,
  items,
  today,
  canEdit,
  gesture,
  onStartItem,
  onStartCreate,
  onOpenTask,
  onOpenDay,
  eventById,
  calendarById,
}: GridProps & { anchor: string }) {
  // Ref стоит на полотне, а не на области прокрутки: его прямоугольник едет
  // вместе с содержимым, и день под курсором остаётся верным на любом смещении.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<EventPopup | null>(null);
  const weeks = useMemo(() => weeksOf(range), [range]);
  const allDays = useMemo(() => daysOf(range), [range]);
  const currentMonth = monthIndex(anchor);

  const frame = useCallback(
    (e: React.PointerEvent): GestureFrame | null => {
      const el = canvasRef.current;
      if (!el) return null;
      return {
        rect: el.getBoundingClientRect(),
        days: allDays,
        columns: 7,
        timed: false,
        startX: e.clientX,
        startY: e.clientY,
      };
    },
    [allDays],
  );

  // Без useCallback: компилятор React мемоизирует сам, а руками выписанные
  // зависимости здесь с его выводом не совпадали и отключали оптимизацию всему
  // компоненту.
  const openEvent = (item: CalendarItem, rect: DOMRect) => {
    const event = eventById.get(item.id);
    if (event) setPopup({ event, item, x: rect.left, y: rect.bottom + 4 });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 border-b border-border">
        {WEEKDAYS_SHORT.map((w, i) => (
          <span
            key={w}
            className={cn(
              "flex-1 py-1 text-center text-[11px] font-semibold uppercase tracking-wide",
              i >= 5 ? "text-muted-foreground/70" : "text-muted-foreground",
            )}
          >
            {w}
          </span>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          ref={canvasRef}
          onPointerDown={(e) => {
            if (!canEdit || e.button !== 0) return;
            // Нажатие с плашки сюда не доходит — она останавливает всплытие.
            const f = frame(e);
            if (f) onStartCreate(e, f);
          }}
          className="flex min-h-full select-none flex-col"
        >
          {weeks.map((week) => (
            <MonthWeek
              key={week[0]}
              week={week}
              items={items}
              today={today}
              currentMonth={currentMonth}
              gesture={gesture}
              canEdit={canEdit}
              onStartItem={(e, item, kind) => {
                const f = frame(e);
                if (f) onStartItem(e, item, kind, f);
              }}
              onOpenTask={onOpenTask}
              onOpenDay={onOpenDay}
              onEventClick={openEvent}
            />
          ))}
        </div>
      </div>

      {popup && (
        <EventPanel
          popup={popup}
          calendar={calendarById.get(popup.event.calendar_id)}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}

function MonthWeek({
  week,
  items,
  today,
  currentMonth,
  gesture,
  canEdit,
  onStartItem,
  onOpenTask,
  onOpenDay,
  onEventClick,
}: {
  week: string[];
  items: CalendarItem[];
  today: string;
  currentMonth: number;
  gesture: Gesture | null;
  canEdit: boolean;
  onStartItem: (e: React.PointerEvent, item: CalendarItem, kind: CalendarDragKind) => void;
  onOpenTask: (id: string) => void;
  onOpenDay: (day: string) => void;
  onEventClick: (item: CalendarItem, rect: DOMRect) => void;
}) {
  const bars = useMemo(() => layoutBars(items, week), [items, week]);
  const barLanes = laneCount(bars);

  /**
   * Задачи со временем в месяце показываются плашками под полосами: часовой
   * сетки здесь нет, но выкидывать задачу из месяца из-за того, что ей задали
   * время, нельзя.
   */
  const timedByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      if (item.bar || !week.includes(item.startDay)) continue;
      const list = map.get(item.startDay);
      if (list) list.push(item);
      else map.set(item.startDay, [item]);
    }
    for (const list of map.values()) list.sort((a, b) => a.startMinutes - b.startMinutes);
    return map;
  }, [items, week]);

  const maxTimed = week.reduce((n, d) => Math.max(n, timedByDay.get(d)?.length ?? 0), 0);
  const lanes = barLanes + maxTimed;
  // Последняя дорожка отдаётся строке «ещё N», когда влезает не всё: иначе
  // счётчик скрытого сам оказался бы скрытым.
  const visibleLanes = lanes > MONTH_LANES ? MONTH_LANES - 1 : lanes;

  const hiddenCount = (day: string) => {
    const dayBars = bars.filter((b) => b.item.startDay <= day && b.item.endDay >= day);
    const hiddenBars = dayBars.filter((b) => b.lane >= visibleLanes).length;
    const timed = timedByDay.get(day) ?? [];
    const hiddenTimed = timed.filter((_, i) => barLanes + i >= visibleLanes).length;
    return hiddenBars + hiddenTimed;
  };

  return (
    <div className="relative flex min-h-24 flex-1 border-b border-border last:border-b-0">
      {week.map((day) => {
        const outside = monthIndex(day) !== currentMonth;
        return (
          <div
            key={day}
            className={cn(
              "min-w-0 flex-1 border-r border-border last:border-r-0",
              isWeekend(day) && "bg-muted/30",
              outside && "bg-muted/50",
              day === today && "bg-primary/5",
            )}
          >
            <button
              onClick={() => onOpenDay(day)}
              className="flex w-full items-start justify-end px-1.5 pt-1"
              style={{ height: DAY_NUM_H }}
            >
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums transition-colors hover:bg-muted",
                  outside ? "text-muted-foreground/50" : "text-muted-foreground",
                  day === today && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
                )}
              >
                {dayOfMonth(day)}
              </span>
            </button>
          </div>
        );
      })}

      {/* Слой плашек: своя сетка 7 × дорожки, поэтому многодневная полоса —
          один элемент на несколько столбцов, а не склейка из обрезков. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 grid"
        style={{
          top: DAY_NUM_H,
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gridAutoRows: LANE_H,
        }}
      >
        {bars
          .filter((b) => b.lane < visibleLanes)
          .map((b) => (
            <div
              key={b.item.key}
              className="pointer-events-auto min-w-0 px-0.5"
              style={{ gridColumn: `${b.offset + 1} / span ${b.span}`, gridRow: b.lane + 1 }}
            >
              <Chip
                item={b.item}
                variant="bar"
                style={{ height: CHIP_H }}
                className={cn(
                  b.clippedStart && "rounded-l-none",
                  b.clippedEnd && "rounded-r-none",
                  gesture?.type === "item" && gesture.item.key === b.item.key && "opacity-70 shadow-md",
                )}
                onOpen={onOpenTask}
                onStart={canEdit && b.item.editable ? (e, kind) => onStartItem(e, b.item, kind) : undefined}
                onEventClick={onEventClick}
              />
            </div>
          ))}

        {week.flatMap((day, col) =>
          (timedByDay.get(day) ?? []).map((item, i) => {
            const lane = barLanes + i;
            if (lane >= visibleLanes) return null;
            return (
              <div
                key={item.key}
                className="pointer-events-auto min-w-0 px-0.5"
                style={{ gridColumn: col + 1, gridRow: lane + 1 }}
              >
                <Chip
                  item={item}
                  variant="bar"
                  style={{ height: CHIP_H }}
                  className={cn(
                    gesture?.type === "item" && gesture.item.key === item.key && "opacity-70 shadow-md",
                  )}
                  onOpen={onOpenTask}
                  onStart={canEdit && item.editable ? (e, kind) => onStartItem(e, item, kind) : undefined}
                  onEventClick={onEventClick}
                />
              </div>
            );
          }),
        )}

        {week.map((day, col) => {
          const hidden = hiddenCount(day);
          if (hidden <= 0) return null;
          return (
            <button
              key={`more-${day}`}
              onClick={() => onOpenDay(day)}
              onPointerDown={(e) => e.stopPropagation()}
              className="pointer-events-auto mx-1 truncate rounded px-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              style={{ gridColumn: col + 1, gridRow: visibleLanes + 1, height: CHIP_H }}
            >
              ещё {hidden}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- Неделя и день -----------------------------------------------------------------

function TimeGrid({
  range,
  items,
  today,
  canEdit,
  gesture,
  onStartItem,
  onStartCreate,
  onOpenTask,
  onOpenDay,
  eventById,
  calendarById,
}: GridProps) {
  const days = useMemo(() => daysOf(range), [range]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const allDayRef = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<EventPopup | null>(null);
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);

  // Линия текущего времени появляется только после гидрации: на сервере
  // «сейчас» — это время контейнера, и разметка разошлась бы с браузерной.
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const id = window.setInterval(tick, NOW_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Прокрутка к рабочему дню при открытии: полночь сверху означала бы, что сетку
  // приходится крутить вручную каждый раз.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_H;
  }, []);

  const allDayBars = useMemo(() => layoutBars(items, days), [items, days]);

  // Без useCallback: компилятор React мемоизирует сам, а руками выписанные
  // зависимости здесь с его выводом не совпадали и отключали оптимизацию всему
  // компоненту.
  const openEvent = (item: CalendarItem, rect: DOMRect) => {
    const event = eventById.get(item.id);
    if (event) setPopup({ event, item, x: rect.left, y: rect.bottom + 4 });
  };

  const frameOf = useCallback(
    (e: React.PointerEvent, el: HTMLElement | null, timed: boolean): GestureFrame | null => {
      if (!el) return null;
      return {
        rect: el.getBoundingClientRect(),
        days,
        columns: days.length,
        timed,
        startX: e.clientX,
        startY: e.clientY,
      };
    },
    [days],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Шапка дней */}
      <div className="flex shrink-0 border-b border-border">
        <div className="shrink-0" style={{ width: GUTTER_W }} />
        {days.map((day) => (
          <DayHead key={day} day={day} today={today} onOpen={onOpenDay} compact={days.length > 1} />
        ))}
      </div>

      {/* Полоса «весь день»: многодневное и всё, у чего нет времени */}
      <div className="flex shrink-0 border-b border-border">
        <div
          className="shrink-0 py-1.5 pr-2 text-right text-[10px] uppercase leading-none text-muted-foreground"
          style={{ width: GUTTER_W }}
        >
          весь день
        </div>
        <div
          className="min-w-0 flex-1 overflow-y-auto py-0.5"
          style={{ maxHeight: ALLDAY_LANES * LANE_H + 4 }}
        >
          <div
            ref={allDayRef}
            onPointerDown={(e) => {
              if (!canEdit || e.button !== 0) return;
              const f = frameOf(e, allDayRef.current, false);
              if (f) onStartCreate(e, f);
            }}
            className="grid select-none"
            style={{
              gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
              gridAutoRows: LANE_H,
              minHeight: LANE_H,
            }}
          >
            {allDayBars.map((b) => (
              <div
                key={b.item.key}
                className="min-w-0 px-0.5"
                style={{ gridColumn: `${b.offset + 1} / span ${b.span}`, gridRow: b.lane + 1 }}
              >
                <Chip
                  item={b.item}
                  variant="bar"
                  style={{ height: CHIP_H }}
                  className={cn(
                    b.clippedStart && "rounded-l-none",
                    b.clippedEnd && "rounded-r-none",
                    gesture?.type === "item" && gesture.item.key === b.item.key && "opacity-70 shadow-md",
                  )}
                  onOpen={onOpenTask}
                  onStart={
                    canEdit && b.item.editable
                      ? (e, kind) => {
                          const f = frameOf(e, allDayRef.current, false);
                          if (f) onStartItem(e, b.item, kind, f);
                        }
                      : undefined
                  }
                  onEventClick={openEvent}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Часовая сетка */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: 24 * HOUR_H }}>
          <div className="relative shrink-0" style={{ width: GUTTER_W }}>
            {Array.from({ length: 24 }, (_, h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: h * HOUR_H }}
              >
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>

          <div
            ref={gridRef}
            onPointerDown={(e) => {
              if (!canEdit || e.button !== 0) return;
              const f = frameOf(e, gridRef.current, true);
              if (f) onStartCreate(e, f);
            }}
            className="relative min-w-0 flex-1 select-none"
          >
            {/* Линии часов */}
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="pointer-events-none absolute inset-x-0 border-t border-border/60"
                style={{ top: h * HOUR_H }}
              />
            ))}

            <div
              className="absolute inset-0 grid"
              style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
            >
              {days.map((day) => (
                <DayColumn
                  key={day}
                  day={day}
                  items={items}
                  today={today}
                  nowMinutes={nowMinutes}
                  gesture={gesture}
                  canEdit={canEdit}
                  onOpenTask={onOpenTask}
                  onStartItem={(e, item, kind) => {
                    const f = frameOf(e, gridRef.current, true);
                    if (f) onStartItem(e, item, kind, f);
                  }}
                  onEventClick={openEvent}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {popup && (
        <EventPanel
          popup={popup}
          calendar={calendarById.get(popup.event.calendar_id)}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}

/** Заголовок столбца дня: число крупнее дня недели, сегодня — заливкой. */
function DayHead({
  day,
  today,
  onOpen,
  compact,
}: {
  day: string;
  today: string;
  onOpen: (day: string) => void;
  compact: boolean;
}) {
  const isToday = day === today;
  return (
    <button
      onClick={() => onOpen(day)}
      className="flex flex-1 flex-col items-center gap-0.5 py-1.5 transition-colors hover:bg-muted/50"
    >
      <span
        className={cn(
          "text-[10px] uppercase",
          isWeekend(day) ? "text-muted-foreground/70" : "text-muted-foreground",
        )}
      >
        {WEEKDAYS_SHORT[weekday(day)]}
      </span>
      <span
        className={cn(
          "flex items-center justify-center rounded-full text-sm tabular-nums",
          compact ? "size-6" : "size-7",
          isToday ? "bg-primary font-semibold text-primary-foreground" : "font-medium",
        )}
      >
        {dayOfMonth(day)}
      </span>
    </button>
  );
}

function DayColumn({
  day,
  items,
  today,
  nowMinutes,
  gesture,
  canEdit,
  onOpenTask,
  onStartItem,
  onEventClick,
}: {
  day: string;
  items: CalendarItem[];
  today: string;
  nowMinutes: number | null;
  gesture: Gesture | null;
  canEdit: boolean;
  onOpenTask: (id: string) => void;
  onStartItem: (e: React.PointerEvent, item: CalendarItem, kind: CalendarDragKind) => void;
  onEventClick: (item: CalendarItem, rect: DOMRect) => void;
}) {
  const blocks = useMemo(() => layoutDay(items, day), [items, day]);

  return (
    <div
      className={cn(
        "relative min-w-0 border-r border-border/60 last:border-r-0",
        isWeekend(day) && "bg-muted/20",
      )}
    >
      {blocks.map(({ item, column, columns }) => (
        <div
          key={item.key}
          className="absolute px-0.5"
          style={{
            top: (item.startMinutes / 60) * HOUR_H,
            // Минимальная высота: блок на пять минут иначе превращается в
            // полоску без подписи, по которой не попасть курсором.
            height: Math.max(
              (SNAP_MINUTES / 60) * HOUR_H,
              ((item.endMinutes - item.startMinutes) / 60) * HOUR_H,
            ),
            left: `${(column / columns) * 100}%`,
            width: `${(1 / columns) * 100}%`,
          }}
        >
          <Chip
            item={item}
            variant="block"
            style={{ height: "100%" }}
            className={cn(
              "shadow-sm",
              // Пунктир у выведенного края: длительность нарисована, а не задана,
              // и обещать её сплошной границей нельзя.
              item.inferredEnd && "border-b border-dashed border-current/40",
              item.inferredStart && "border-t border-dashed border-current/40",
              gesture?.type === "item" && gesture.item.key === item.key && "opacity-80 shadow-md",
            )}
            onOpen={onOpenTask}
            onStart={canEdit && item.editable ? (e, kind) => onStartItem(e, item, kind) : undefined}
            onEventClick={onEventClick}
          />
        </div>
      ))}

      {day === today && nowMinutes != null && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
          style={{ top: (nowMinutes / 60) * HOUR_H }}
        >
          <span className="absolute -left-1 -top-1 size-2 rounded-full bg-red-500" />
        </div>
      )}
    </div>
  );
}

/** Переключатель масштаба. Подписи — из модели, чтобы не разойтись с ней. */
function ScaleSwitch({
  scale,
  onChange,
}: {
  scale: CalendarScale;
  onChange: (scale: CalendarScale) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {(Object.keys(CALENDAR_SCALE_LABELS) as CalendarScale[]).map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={cn(
            "rounded-md px-2 py-1 text-xs font-medium transition-colors",
            scale === s ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {CALENDAR_SCALE_LABELS[s]}
        </button>
      ))}
    </div>
  );
}
