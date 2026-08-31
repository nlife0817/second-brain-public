"use client";

// «Мои задачи», мобильный экран: те же данные и та же раскладка по плану дня,
// что на десктопе (/v2/my) — обе считает `daySections`, — но под палец. Карточку открывает и push-диплинк ?task=
// (холодный старт), и сообщение service worker (приложение уже открыто).

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUp,
  CalendarCheck,
  CalendarPlus,
  Eye,
  EyeOff,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { CreateTaskSheet, GlobalSearch, TaskSheet } from "@/components/v2/lazy";
import { TaskCard } from "@/components/v2/TaskCard";
import { PullToRefresh } from "@/components/v2/mobile/PullToRefresh";
import { useAppResume, useBackDismiss, useTaskDeepLink } from "@/components/v2/mobile/hooks";
import { api } from "@/lib/core/client";
import { daySections, UNPLANNED_FIRST_SECTION, type PlanAction } from "@/lib/core/day-plan";
import { cachedGet, invalidate, seed } from "@/lib/core/query";
import { applyTaskChange } from "@/lib/core/task-change";
import type { TaskDetail, TaskListItem } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { todayIso } from "@/lib/core/views";
import { cn } from "@/lib/utils";

/** Классы подсветки заголовка раздела — смысл тона задаёт `daySections`. */
const TONE_CLASS = {
  danger: "text-red-600 dark:text-red-400",
  warn: "text-amber-700 dark:text-amber-400",
  none: "text-muted-foreground",
} as const;

const ACTION_LABEL: Record<Exclude<PlanAction, null>, string> = {
  take: "Взять на сегодня",
  move: "Перенести на сегодня",
  clear: "Снять с сегодня",
};

export function MobileMyTasksClient({ initial }: { initial: TaskListItem[] }) {
  const { orgId, refreshProjects, refreshUnread } = useV2Store();
  const deepLinkTaskId = useSearchParams().get("task");
  const [tasks, setTasks] = useState<TaskListItem[]>(initial);
  const [showDone, setShowDone] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(deepLinkTaskId);
  const [searchOpen, setSearchOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = orgId ? `/orgs/${orgId}/tasks${showDone ? "?done=1" : ""}` : null;
  /** Ключ списка, который посчитал сервер: без завершённых. */
  const initialPath = orgId ? `/orgs/${orgId}/tasks` : null;

  useEffect(() => {
    if (initialPath) seed(initialPath, initial);
  }, [initialPath, initial]);

  const load = useCallback(
    async (opts: { force?: boolean } = {}) => {
      if (!path) return;
      try {
        setTasks(await cachedGet<TaskListItem[]>(path, opts));
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

  useEffect(() => {
    void load();
  }, [load]);

  // Возврат в приложение через день: список не должен показывать вчерашнее.
  // Именно принудительно — кэш тут был бы ровно тем, чего мы избегаем.
  useAppResume(reload);

  // Ссылка из пуша или поиска открывает карточку сразу, на первом же рендере, и
  // ещё раз, если ссылка сменилась при уже смонтированном экране. Правка
  // состояния во время рендера — задокументированный React способ подстроиться
  // под изменившийся вход; эффект здесь означал бы лишний проход рендера до
  // отрисовки.
  const [seenDeepLink, setSeenDeepLink] = useState(deepLinkTaskId);
  if (deepLinkTaskId !== seenDeepLink) {
    setSeenDeepLink(deepLinkTaskId);
    if (deepLinkTaskId) setOpenTaskId(deepLinkTaskId);
  }
  useTaskDeepLink(setOpenTaskId);

  const closeTask = useCallback(() => setOpenTaskId(null), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  // «Назад» на Android закрывает верхний слой, а не уводит с экрана.
  useBackDismiss(!!openTaskId, closeTask);
  useBackDismiss(searchOpen, closeSearch);
  useBackDismiss(createOpen, closeCreate);

  async function quickAdd() {
    if (!orgId || !quickTitle.trim() || adding) return;
    setAdding(true);
    try {
      await api.post(`/orgs/${orgId}/tasks`, { title: quickTitle.trim() });
      setQuickTitle("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать задачу");
    } finally {
      setAdding(false);
    }
  }

  const openTask = useCallback((id: string) => setOpenTaskId(id), []);

  const groups = useMemo(() => daySections(tasks, { today: todayIso(), showDone }), [tasks, showDone]);

  /**
   * Планирование одним нажатием — то же, что на десктопе: строка правится на
   * месте, без перечитывания списка, иначе наполнение дня на телефоне стоило бы
   * запроса на каждый тап.
   */
  const plan = useCallback(
    async (taskId: string, planned_date: string | null) => {
      if (!orgId) return;
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, planned_date } : t)));
      try {
        const updated = await api.patch<TaskDetail>(`/orgs/${orgId}/tasks/${taskId}`, { planned_date });
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, planned_date: updated.planned_date } : t)),
        );
        // Кэш держит старую строку — следующий заход на экран показал бы
        // задачу в прежнем разделе. Сбрасываем ветку целиком, как делает
        // `reload`: списков два (с завершёнными и без), и устареть успевают оба.
        invalidate(`/orgs/${orgId}/tasks`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось изменить план");
        await load({ force: true });
      }
    },
    [orgId, load],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-3">
        <h1 className="flex-1 font-heading text-lg font-semibold tracking-tight">Мои задачи</h1>
        <button
          onClick={() => setSearchOpen(true)}
          className="rounded-lg p-2 text-muted-foreground active:bg-muted"
          aria-label="Поиск"
        >
          <Search className="size-4" />
        </button>
        <button
          onClick={() => setShowDone((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs",
            showDone ? "bg-muted text-foreground" : "text-muted-foreground",
          )}
        >
          {showDone ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          Готовые
        </button>
      </header>

      <PullToRefresh
        onRefresh={async () => {
          await Promise.all([reload(), refreshUnread()]);
        }}
        className="px-4 py-3"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5">
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
                продолжение того же ввода, а не отдельная форма. */}
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
            {/* Экранная клавиатура не всегда показывает Enter — нужна кнопка. */}
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

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0 flex-1">{error}</span>
              <button onClick={() => void reload()} className="shrink-0 font-medium underline">
                Повторить
              </button>
            </div>
          )}

          {loading && (
            <div className="flex flex-col gap-1.5" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          )}

          {!loading && groups.length === 0 && !error && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Пусто. Добавьте задачу или дождитесь назначения.
            </p>
          )}

          {groups.map((g, i) => (
            <section key={g.key}>
              {/* Граница между взятым в работу и запасом, из которого день и
                  наполняют. */}
              {g.key === UNPLANNED_FIRST_SECTION && i > 0 && (
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    Без плана
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <h2 className={cn("mb-2 text-xs font-semibold uppercase tracking-wide", TONE_CLASS[g.tone])}>
                {g.title} · {g.items.length}
              </h2>
              {/* Разделители вместо зазора и рамок: список задач на телефоне
                  читается как список, а не как стопка отдельных карточек. */}
              <div className="flex flex-col divide-y divide-border/50">
                {g.items.map((t) => (
                  <div key={t.id} className="flex items-center">
                    <TaskCard task={t} variant="compact" onOpen={openTask} className="min-w-0 flex-1" />
                    {g.action && (
                      // На телефоне кнопка видна всегда: наведения здесь нет, а
                      // цель нажатия должна быть не меньше 44 пикселей.
                      <button
                        onClick={() => void plan(t.id, g.action === "clear" ? null : todayIso())}
                        aria-label={ACTION_LABEL[g.action]}
                        className="shrink-0 rounded-lg p-2.5 text-muted-foreground active:bg-muted"
                      >
                        {g.action === "clear" ? (
                          <X className="size-4" />
                        ) : g.action === "move" ? (
                          <CalendarCheck className="size-4" />
                        ) : (
                          <CalendarPlus className="size-4" />
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </PullToRefresh>

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
      <GlobalSearch mobile open={searchOpen} onOpenChange={setSearchOpen} onPickTask={setOpenTaskId} />
      <CreateTaskSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialTitle={quickTitle}
        onCreated={() => {
          setQuickTitle("");
          void reload();
          void refreshProjects();
        }}
      />
    </div>
  );
}
