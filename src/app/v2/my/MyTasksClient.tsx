"use client";

// «Мои задачи»: назначенные мне + личный инбокс (задачи без проекта).
//
// Первый список приходит из серверного рендера (`initial`) — на открытии экрана
// запроса нет. Дальше данные живут в клиентском кэше: возврат на экран рисуется
// мгновенно, а переключение «показывать завершённые» тянет свой список один раз.

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { CardSettingsPopover } from "@/components/v2/CardSettings";
import { TaskCard } from "@/components/v2/TaskCard";
import { TaskSheet } from "@/components/v2/lazy";
import { api } from "@/lib/core/client";
import { invalidate, useQuery } from "@/lib/core/query";
import { applyTaskChange } from "@/lib/core/task-change";
import type { TaskListItem } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function MyTasksClient({ initial }: { initial: TaskListItem[] }) {
  const orgId = useV2Store((s) => s.orgId);
  const refreshProjects = useV2Store((s) => s.refreshProjects);
  // Push-уведомление ведёт на /v2/my?task=<id> — открываем карточку сразу.
  const deepLinkTaskId = useSearchParams().get("task");
  const [showDone, setShowDone] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const path = orgId ? `/orgs/${orgId}/tasks${showDone ? "?done=1" : ""}` : null;
  // Серверный рендер считает список без завершённых — он и есть initial.
  const { data, loading, error, refresh, update } = useQuery<TaskListItem[]>(path, {
    initial: showDone ? undefined : initial,
  });
  const tasks = useMemo(() => data ?? [], [data]);

  useEffect(() => {
    if (deepLinkTaskId) setOpenTaskId(deepLinkTaskId);
  }, [deepLinkTaskId]);

  const reload = useCallback(async () => {
    // Мутация меняет оба списка (с завершёнными и без) — сбрасываем ветку целиком.
    if (orgId) invalidate(`/orgs/${orgId}/tasks`);
    await refresh();
  }, [orgId, refresh]);

  async function quickAdd() {
    if (!orgId || !quickTitle.trim()) return;
    try {
      await api.post(`/orgs/${orgId}/tasks`, { title: quickTitle.trim() });
      setQuickTitle("");
      setCreateError(null);
      await reload();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Не удалось создать задачу");
    }
  }

  // Стабильная ссылка — иначе memo на TaskCard не работает.
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

  const message = createError ?? error;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <h1 className="text-base font-semibold">Мои задачи</h1>
        <span className="flex-1" />
        <CardSettingsPopover />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="size-3.5 accent-primary"
          />
          Показывать завершённые
        </label>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2">
            <Plus className="size-4 text-muted-foreground" />
            <input
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void quickAdd()}
              placeholder="Быстро добавить задачу в личный инбокс…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {message && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p>}
          {loading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
          {!loading && groups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
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
      </div>

      <TaskSheet
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        onChanged={(change) => {
          // Правку строки применяем на месте — полный перечит списка нужен
          // только когда в нём появилась новая задача.
          if (change.type === "reload") {
            void reload();
            void refreshProjects();
            return;
          }
          update((prev) => applyTaskChange(prev, change) ?? prev);
          // Счётчики проектов в сайдбаре — по подтверждённой правке, иначе
          // запрос уходил бы дважды на каждое действие.
          if (change.type === "deleted" || change.confirmed) void refreshProjects();
        }}
      />
    </div>
  );
}
