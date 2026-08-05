"use client";

// Календарь на телефоне: все доступные задачи и встречи внешних календарей на
// одном полотне — месяц, неделя, день.
//
// Данные те же, что у десктопного «Все задачи» (`listAllTasks`), и та же область
// настроек `ViewStore` (`all`): фильтр, собранный чипами здесь, конструктор
// условий на десктопе видит как обычные группы.
//
// Что легко сломать обратной правкой:
//
//  1. **Полотно не ходит на сервер за листание.** Задачи приезжают один раз и
//     фильтруются на клиенте — как в таблице и на десктопном календаре. Плата та
//     же: список ограничен `ALL_TASKS_CAP`, завершённые приходят только по
//     условию «Готово = Показать».
//  2. **Опорный день появляется после гидрации** (`useToday`). Зона процесса на
//     сервере — UTC контейнера: посчитанное там «сегодня» ночью отличается на
//     сутки, а `localPoint` внешнего события и вовсе обязан считаться в браузере.
//     Поэтому полотно монтируется отдельным компонентом, когда день уже известен.
//  3. **Жеста «потянуть, чтобы обновить» здесь нет** — полотно само является
//     областью прокрутки (то же, что на экране проекта). Вместо него кнопка в
//     шапке и обновление при возврате в приложение.
//  4. **Правки дат жестом нет.** Тап открывает карточку — там даты и меняются.
//     Перетаскивание полосы пальцем спорило бы и с прокруткой, и с листанием.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { TaskSheet } from "@/components/v2/lazy";
import { PriorityDot } from "@/components/v2/bits";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CalendarFilterSheet } from "@/components/v2/mobile/calendar/CalendarFilterSheet";
import { DEFAULT_EVENT_COLOR, MobileEventSheet } from "@/components/v2/mobile/calendar/parts";
import { MobileMonthView } from "@/components/v2/mobile/calendar/MobileMonthView";
import { MobileTimeView } from "@/components/v2/mobile/calendar/MobileTimeView";
import { useAppResume, useBackDismiss, useTaskDeepLink, useToday } from "@/components/v2/mobile/hooks";
import { TaskCount } from "@/components/v2/tasks/ViewToolbar";
import {
  CALENDAR_SCALE_LABELS,
  calendarRange,
  eventItem,
  rangeTitle,
  shiftAnchor,
  taskItem,
  type CalendarItem,
  type CalendarScale,
} from "@/lib/core/calendar";
import { startOfMonth } from "@/lib/core/days";
import { cachedGet, invalidate, peek, seed } from "@/lib/core/query";
import { applyTaskChange } from "@/lib/core/task-change";
import type { AllTasksResult, CalendarBrief, CalendarEventRow, TaskRow } from "@/lib/core/types";
import { useExternalCalendars } from "@/lib/core/use-external-calendars";
import { useLoad } from "@/lib/core/use-load";
import { useV2Store } from "@/lib/core/ui-store";
import { ViewStoreProvider, useViewStore } from "@/lib/core/view-store";
import { filterTasks, makeMatchContext, showsDone, visiblePool } from "@/lib/core/views";
import { cn } from "@/lib/utils";

/** Насколько уверенным должен быть горизонтальный жест, чтобы листнуть период. */
const SWIPE_PX = 60;

export function MobileCalendarClient({ initial }: { initial: AllTasksResult }) {
  return (
    <ViewStoreProvider scope="all">
      <MobileCalendarScreen initial={initial} />
    </ViewStoreProvider>
  );
}

function MobileCalendarScreen({ initial }: { initial: AllTasksResult }) {
  const { orgId, refreshProjects } = useV2Store();
  const deepLinkTaskId = useSearchParams().get("task");
  const filterGroups = useViewStore((s) => s.groups);
  const today = useToday();

  const [tasks, setTasks] = useState<TaskRow[]>(initial.tasks);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(deepLinkTaskId);

  // Завершённых сервер по умолчанию не отдаёт: «Показать готовые» не только
  // снимает отсев, но и добавляет `&done=1` — иначе фильтр покажет пустоту.
  const wantsDone = showsDone(filterGroups);
  const basePath = orgId ? `/orgs/${orgId}/tasks?view=all` : null;
  const path = basePath ? `${basePath}${wantsDone ? "&done=1" : ""}` : null;

  useEffect(() => {
    if (basePath) seed(basePath, initial);
  }, [basePath, initial]);

  const load = useCallback(
    async (opts: { force?: boolean } = {}) => {
      if (!path) return;
      if (opts.force || peek<AllTasksResult>(path) === undefined) setLoading(true);
      try {
        const result = await cachedGet<AllTasksResult>(path, opts);
        setTasks(result.tasks);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить задачи");
      } finally {
        setLoading(false);
      }
    },
    [path],
  );

  const reload = useCallback(async () => {
    if (orgId) invalidate(`/orgs/${orgId}/tasks`);
    await load({ force: true });
  }, [orgId, load]);

  useLoad(load);
  useAppResume(reload);

  // Ссылка из пуша или поиска открывает карточку сразу, на первом же рендере, и
  // ещё раз, если ссылка сменилась при уже смонтированном экране.
  const [seenDeepLink, setSeenDeepLink] = useState(deepLinkTaskId);
  if (deepLinkTaskId !== seenDeepLink) {
    setSeenDeepLink(deepLinkTaskId);
    if (deepLinkTaskId) setOpenTaskId(deepLinkTaskId);
  }
  useTaskDeepLink(setOpenTaskId);

  const closeTask = useCallback(() => setOpenTaskId(null), []);
  useBackDismiss(!!openTaskId, closeTask);

  return (
    <div className="flex h-full flex-col">
      {today ? (
        <CalendarBody
          today={today}
          tasks={tasks}
          loading={loading}
          error={error}
          onDismissError={() => setError(null)}
          onReload={reload}
          onOpenTask={setOpenTaskId}
        />
      ) : (
        <div className="flex flex-1 flex-col gap-2 px-4 py-3" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

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
            if (orgId) invalidate(`/orgs/${orgId}/tasks`);
            void refreshProjects();
          }
        }}
      />
    </div>
  );
}

/** Полотно с шапкой. Отдельный компонент: до гидрации «сегодня» неизвестно. */
function CalendarBody({
  today,
  tasks,
  loading,
  error,
  onDismissError,
  onReload,
  onOpenTask,
}: {
  today: string;
  tasks: TaskRow[];
  loading: boolean;
  error: string | null;
  onDismissError: () => void;
  onReload: () => Promise<void> | void;
  onOpenTask: (id: string) => void;
}) {
  const { statuses, me } = useV2Store();
  const filterGroups = useViewStore((s) => s.groups);
  const search = useViewStore((s) => s.search);
  const scale = useViewStore((s) => s.calendarScale);
  const setScale = useViewStore((s) => s.setCalendarScale);

  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const [filterOpen, setFilterOpen] = useState(false);
  const [undatedOpen, setUndatedOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [popup, setPopup] = useState<{ event: CalendarEventRow; item: CalendarItem } | null>(null);

  const range = useMemo(() => calendarRange(anchor, scale), [anchor, scale]);

  // --- Задачи ------------------------------------------------------------------------

  const matchCtx = useMemo(() => makeMatchContext(me?.id ?? null), [me?.id]);
  const pool = useMemo(() => visiblePool(tasks, filterGroups, statuses), [tasks, filterGroups, statuses]);
  const visibleTasks = useMemo(
    () => filterTasks(pool, filterGroups, search, matchCtx),
    [pool, filterGroups, search, matchCtx],
  );

  const statusColor = useMemo(() => new Map(statuses.map((s) => [s.id, s.color])), [statuses]);
  const taskItems = useMemo(() => {
    const out: CalendarItem[] = [];
    for (const task of visibleTasks) {
      const item = taskItem(task, today, task.status_id ? (statusColor.get(task.status_id) ?? null) : null);
      if (item) out.push(item);
    }
    return out;
  }, [visibleTasks, today, statusColor]);

  /** Задачи без дат: на полотне им места нет, но и терять их нельзя. */
  const undated = useMemo(() => visibleTasks.filter((t) => !t.start_date && !t.due_date), [visibleTasks]);

  // --- Внешние календари ---------------------------------------------------------------

  const { accounts, setAccounts, events, externalError } = useExternalCalendars(range);

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
  const items = useMemo(() => [...taskItems, ...eventItems], [taskItems, eventItems]);

  // --- Навигация --------------------------------------------------------------------

  // Следующий день считается снаружи апдейтера: правка второго состояния внутри
  // него — побочный эффект, который React вправе прогнать сколько угодно раз, и
  // в строгом режиме обновление просто теряется.
  const go = useCallback(
    (delta: number) => {
      const next = shiftAnchor(anchor, scale, delta);
      setAnchor(next);
      // Выбранный день едет вместе с окном: месяц пролистали — список под
      // сеткой обязан показывать день нового месяца, а не остаться в прошлом.
      setSelected(scale === "month" ? startOfMonth(next) : next);
    },
    [anchor, scale],
  );

  const goToday = useCallback(() => {
    setAnchor(today);
    setSelected(today);
  }, [today]);

  const openDay = useCallback(
    (day: string) => {
      setAnchor(day);
      setSelected(day);
      setScale("day");
    },
    [setScale],
  );

  const switchScale = useCallback(
    (next: CalendarScale) => {
      // Из месяца уходим на выбранный день, а не на опорный: человек ткнул в
      // 12-е и нажал «День» — он ждёт двенадцатого.
      if (scale === "month" && next !== "month") setAnchor(selected);
      setScale(next);
    },
    [scale, selected, setScale],
  );

  // Свайп листает период. `preventDefault` не зовём — прокрутка полотна должна
  // работать по-прежнему, поэтому жест решается только по итогу касания.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const from = touch.current;
    touch.current = null;
    if (!from) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - from.x;
    const dy = t.clientY - from.y;
    // Вдвое горизонтальнее вертикального: иначе прокрутка списка через раз
    // оборачивалась бы сменой месяца.
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 2) go(dx < 0 ? 1 : -1);
  };

  const openItem = useCallback(
    (item: CalendarItem) => {
      if (item.kind === "task") {
        onOpenTask(item.id);
        return;
      }
      const event = eventById.get(item.id);
      if (event) setPopup({ event, item });
    },
    [eventById, onOpenTask],
  );

  const closeFilters = useCallback(() => setFilterOpen(false), []);
  const closeUndated = useCallback(() => setUndatedOpen(false), []);
  const closePopup = useCallback(() => setPopup(null), []);
  useBackDismiss(filterOpen, closeFilters);
  useBackDismiss(undatedOpen, closeUndated);
  useBackDismiss(!!popup, closePopup);

  const conditions = filterGroups.reduce((n, g) => n + g.conditions.length, 0);
  const filtering = conditions > 0 || search.length > 0;
  const shownError = error ?? localError ?? externalError;
  const isCurrent = today >= range.from && today <= range.to;

  return (
    <>
      <header className="shrink-0 border-b border-border px-2 pb-1.5 pt-2">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => go(-1)}
            aria-label="Предыдущий период"
            className="rounded-lg p-2 text-muted-foreground active:bg-muted"
          >
            <ChevronLeft className="size-5" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-center font-heading text-base font-semibold tracking-tight first-letter:uppercase">
            {rangeTitle(anchor, scale)}
          </h1>
          <button
            onClick={() => go(1)}
            aria-label="Следующий период"
            className="rounded-lg p-2 text-muted-foreground active:bg-muted"
          >
            <ChevronRight className="size-5" />
          </button>
          {!isCurrent && (
            <button
              onClick={goToday}
              className="rounded-lg border border-border px-2 py-1 text-xs font-medium active:bg-muted"
            >
              Сегодня
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 pt-1.5">
          <div className="flex flex-1 items-center gap-0.5 rounded-lg bg-muted p-0.5">
            {(Object.keys(CALENDAR_SCALE_LABELS) as CalendarScale[]).map((s) => (
              <button
                key={s}
                onClick={() => switchScale(s)}
                className={cn(
                  "flex-1 rounded-md py-1 text-xs font-medium",
                  scale === s ? "bg-background shadow-sm" : "text-muted-foreground",
                )}
              >
                {CALENDAR_SCALE_LABELS[s]}
              </button>
            ))}
          </div>
          <TaskCount shown={visibleTasks.length} total={pool.length} />
          {loading ? (
            <span className="p-2">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </span>
          ) : (
            <button
              onClick={() => void onReload()}
              aria-label="Обновить"
              className="rounded-lg p-2 text-muted-foreground active:bg-muted"
            >
              <RefreshCw className="size-4" />
            </button>
          )}
          <button
            onClick={() => setFilterOpen(true)}
            aria-label="Фильтры"
            className={cn(
              "relative rounded-lg p-2 active:bg-muted",
              filtering ? "text-primary" : "text-muted-foreground",
            )}
          >
            <SlidersHorizontal className="size-4" />
            {conditions > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground">
                {conditions}
              </span>
            )}
          </button>
        </div>
      </header>

      {shownError && (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          <span className="min-w-0 flex-1">{shownError}</span>
          <button
            onClick={() => {
              setLocalError(null);
              onDismissError();
              void onReload();
            }}
            aria-label="Закрыть ошибку"
            className="shrink-0 rounded p-0.5"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {scale === "month" ? (
          <MobileMonthView
            range={range}
            anchor={anchor}
            items={items}
            today={today}
            selected={selected}
            onSelectDay={setSelected}
            onOpen={openItem}
          />
        ) : (
          <MobileTimeView range={range} items={items} today={today} onOpen={openItem} onOpenDay={openDay} />
        )}
      </div>

      {/* Задачи без дат на сетке показать негде, но и молча прятать их нельзя. */}
      {undated.length > 0 && (
        <button
          onClick={() => setUndatedOpen(true)}
          className="flex shrink-0 items-center gap-1.5 border-t border-border px-4 py-2 text-xs text-muted-foreground active:bg-muted"
        >
          <CalendarDays className="size-3.5" />
          Без даты · {undated.length}
        </button>
      )}

      <CalendarFilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        accounts={accounts}
        setAccounts={setAccounts}
        onError={setLocalError}
      />

      <MobileEventSheet
        popup={popup}
        calendar={popup ? calendarById.get(popup.event.calendar_id) : undefined}
        onClose={closePopup}
      />

      <Sheet open={undatedOpen} onOpenChange={setUndatedOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[80dvh] gap-0 rounded-t-2xl pb-[max(env(safe-area-inset-bottom),0.75rem)]"
        >
          <div className="flex items-center gap-2 px-4 pt-3">
            <SheetTitle className="flex-1">Без даты · {undated.length}</SheetTitle>
            <button
              onClick={closeUndated}
              aria-label="Закрыть"
              className="-mr-2 rounded-lg p-2 text-muted-foreground active:bg-muted"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="flex min-h-0 flex-col divide-y divide-border/50 overflow-y-auto px-4 pt-2">
            {undated.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setUndatedOpen(false);
                  onOpenTask(t.id);
                }}
                className="flex items-center gap-2 py-2.5 text-left active:bg-muted"
              >
                <PriorityDot priority={t.priority} className="size-2 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
