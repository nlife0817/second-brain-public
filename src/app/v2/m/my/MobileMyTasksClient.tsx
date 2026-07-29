"use client";

// «Мои задачи», мобильный экран: те же данные и группировка, что на десктопе
// (/v2/my), но раскладка под палец. Карточку открывает и push-диплинк ?task=
// (холодный старт), и сообщение service worker (приложение уже открыто).

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUp, Eye, EyeOff, Plus, Search } from "lucide-react";
import { GlobalSearch, TaskSheet } from "@/components/v2/lazy";
import { TaskCard } from "@/components/v2/TaskCard";
import { PullToRefresh } from "@/components/v2/mobile/PullToRefresh";
import { useAppResume, useBackDismiss, useTaskDeepLink } from "@/components/v2/mobile/hooks";
import { api } from "@/lib/core/client";
import { cachedGet, invalidate, seed } from "@/lib/core/query";
import { applyTaskChange } from "@/lib/core/task-change";
import type { TaskListItem } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function MobileMyTasksClient({ initial }: { initial: TaskListItem[] }) {
  const { orgId, refreshProjects, refreshUnread } = useV2Store();
  const deepLinkTaskId = useSearchParams().get("task");
  const [tasks, setTasks] = useState<TaskListItem[]>(initial);
  const [showDone, setShowDone] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
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

  useEffect(() => {
    if (deepLinkTaskId) setOpenTaskId(deepLinkTaskId);
  }, [deepLinkTaskId]);
  useTaskDeepLink(setOpenTaskId);

  const closeTask = useCallback(() => setOpenTaskId(null), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  // «Назад» на Android закрывает верхний слой, а не уводит с экрана.
  useBackDismiss(!!openTaskId, closeTask);
  useBackDismiss(searchOpen, closeSearch);

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

  const groups = useMemo(() => {
    const today = todayIso();
    const overdue: TaskListItem[] = [];
    const dueToday: TaskListItem[] = [];
    const upcoming: TaskListItem[] = [];
    const noDate: TaskListItem[] = [];
    const done: TaskListItem[] = [];
    for (const t of tasks) {
      if (t.completed_at) done.push(t);
      else if (!t.due_date) noDate.push(t);
      else if (t.due_date < today) overdue.push(t);
      else if (t.due_date === today) dueToday.push(t);
      else upcoming.push(t);
    }
    return [
      { key: "overdue", title: "Просрочено", items: overdue, tone: "text-red-600 dark:text-red-400" },
      { key: "today", title: "Сегодня", items: dueToday, tone: "text-amber-600 dark:text-amber-400" },
      { key: "upcoming", title: "Предстоящие", items: upcoming, tone: "" },
      { key: "nodate", title: "Без срока", items: noDate, tone: "" },
      ...(showDone ? [{ key: "done", title: "Завершённые", items: done, tone: "text-muted-foreground" }] : []),
    ].filter((g) => g.items.length > 0);
  }, [tasks, showDone]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-3">
        <h1 className="flex-1 text-base font-semibold">Мои задачи</h1>
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

          {groups.map((g) => (
            <section key={g.key}>
              <h2 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${g.tone || "text-muted-foreground"}`}>
                {g.title} · {g.items.length}
              </h2>
              <div className="flex flex-col gap-1.5">
                {g.items.map((t) => (
                  <TaskCard key={t.id} task={t} onOpen={openTask} />
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
    </div>
  );
}
