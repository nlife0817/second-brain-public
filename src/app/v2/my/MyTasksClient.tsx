"use client";

// «Мои задачи»: назначенные мне + личный инбокс (задачи без проекта).
//
// Экран разложен по плану дня, а не по дедлайну: сверху то, что я на сегодня
// взял, ниже — «Без плана», разложенное по срокам, откуда день и наполняют
// кнопкой «Сегодня». Раскладку считает чистая `daySections` из lib/core — тем
// же порядком её показывает мобильный экран.
//
// Первый список приходит из серверного рендера (`initial`) — на открытии экрана
// запроса нет. Дальше данные живут в клиентском кэше: возврат на экран рисуется
// мгновенно, а переключение «показывать завершённые» тянет свой список один раз.

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CalendarCheck, CalendarPlus, CheckCircle2, Plus, X } from "lucide-react";
import { CardSettingsPopover } from "@/components/v2/CardSettings";
import { TaskCard } from "@/components/v2/TaskCard";
import { TaskSheet } from "@/components/v2/lazy";
import { api } from "@/lib/core/client";
import { daySections, unplannedStart, type PlanAction } from "@/lib/core/day-plan";
import { invalidate, useQuery } from "@/lib/core/query";
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

/** Подпись кнопки раздела: одно нажатие вместо открытия карточки. */
const ACTION_LABEL: Record<Exclude<PlanAction, null>, string> = {
  take: "Взять на сегодня",
  move: "Перенести на сегодня",
  clear: "Снять с сегодня",
};

export function MyTasksClient({ initial }: { initial: TaskListItem[] }) {
  const orgId = useV2Store((s) => s.orgId);
  const refreshProjects = useV2Store((s) => s.refreshProjects);
  // Push-уведомление ведёт на /v2/my?task=<id> — открываем карточку сразу.
  const deepLinkTaskId = useSearchParams().get("task");
  const [showDone, setShowDone] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [openTaskId, setOpenTaskId] = useState<string | null>(deepLinkTaskId);
  const [createError, setCreateError] = useState<string | null>(null);

  const path = orgId ? `/orgs/${orgId}/tasks${showDone ? "?done=1" : ""}` : null;
  // Серверный рендер считает список без завершённых — он и есть initial.
  const { data, loading, error, refresh, update } = useQuery<TaskListItem[]>(path, {
    initial: showDone ? undefined : initial,
  });
  const tasks = useMemo(() => data ?? [], [data]);

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

  const groups = useMemo(() => daySections(tasks, { today: todayIso(), showDone }), [tasks, showDone]);
  /** Перед этим разделом идёт граница «Без плана»; -1 — границы нет. */
  const unplannedAt = unplannedStart(groups);

  /**
   * Планирование одним нажатием. Строку правим на месте, не перечитывая список:
   * задача только переезжает между разделами, а полный перечит на каждое
   * «взять сегодня» стоил бы запроса на каждый клик при наполнении дня.
   */
  const plan = useCallback(
    async (taskId: string, planned_date: string | null) => {
      if (!orgId) return;
      update((prev) => prev.map((t) => (t.id === taskId ? { ...t, planned_date } : t)));
      try {
        const updated = await api.patch<TaskDetail>(`/orgs/${orgId}/tasks/${taskId}`, { planned_date });
        update((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, planned_date: updated.planned_date } : t)),
        );
      } catch (e) {
        setCreateError(e instanceof Error ? e.message : "Не удалось изменить план");
        await reload();
      }
    },
    [orgId, update, reload],
  );

  const message = createError ?? error;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Мои задачи</h1>
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
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <CheckCircle2 className="size-8 text-muted-foreground/40" />
              <p className="text-sm font-medium">Все задачи разобраны</p>
              <p className="text-sm text-muted-foreground">
                Добавьте новую в поле выше — или дождитесь назначения.
              </p>
            </div>
          )}

          {groups.map((g, i) => (
            <section key={g.key}>
              {/* Граница между «моим днём» и запасом, из которого его наполняют:
                  разделы ниже — это ещё не взятая работа. Подпись рисуется у
                  первого такого раздела, какой бы он ни был по счёту. */}
              {i === unplannedAt && (
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
              {/* Плотный список: строки без зазора, разделены линией. Отрицательный
                  отступ оставляет названия на одной вертикали с заголовком группы,
                  а подсветку наведения растягивает на всю ширину колонки. */}
              <div className="-mx-2 flex flex-col divide-y divide-border/40">
                {g.items.map((t) => (
                  <div key={t.id} className="group/row flex items-center">
                    <TaskCard task={t} variant="row" onOpen={openTask} className="min-w-0 flex-1" />
                    {g.action && (
                      // Кнопка снаружи карточки: строка списка сама по себе
                      // кнопка (открыть задачу), а вложенная кнопка в кнопку —
                      // невалидная разметка. Видна при наведении и по фокусу с
                      // клавиатуры, иначе список пестрит иконками.
                      <button
                        onClick={() => void plan(t.id, g.action === "clear" ? null : todayIso())}
                        title={ACTION_LABEL[g.action]}
                        aria-label={ACTION_LABEL[g.action]}
                        className="mr-2 shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
                      >
                        {g.action === "clear" ? (
                          <X className="size-3.5" />
                        ) : g.action === "move" ? (
                          <CalendarCheck className="size-3.5" />
                        ) : (
                          <CalendarPlus className="size-3.5" />
                        )}
                      </button>
                    )}
                  </div>
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
