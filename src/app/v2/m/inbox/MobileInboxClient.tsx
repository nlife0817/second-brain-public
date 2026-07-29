"use client";

// Уведомления, мобильный экран: список из core.notifications, тап открывает
// задачу и отмечает прочитанным (как /v2/inbox на десктопе).

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { TaskSheet } from "@/components/v2/lazy";
import { PullToRefresh } from "@/components/v2/mobile/PullToRefresh";
import { useAppResume, useBackDismiss, useTaskDeepLink } from "@/components/v2/mobile/hooks";
import { api } from "@/lib/core/client";
import { cachedGet, patch, seed } from "@/lib/core/query";
import type { CoreNotification } from "@/lib/core/types";
import { notificationLine } from "@/lib/core/notification-text";
import { useV2Store } from "@/lib/core/ui-store";
import { syncReadState } from "@/lib/notifications/client";
import { cn } from "@/lib/utils";

export function MobileInboxClient({ initial }: { initial: CoreNotification[] }) {
  const { orgId, refreshUnread } = useV2Store();
  const [items, setItems] = useState<CoreNotification[]>(initial);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = orgId ? `/orgs/${orgId}/notifications` : null;

  useEffect(() => {
    if (path) seed(path, { items: initial });
  }, [path, initial]);

  const load = useCallback(
    async (opts: { force?: boolean } = {}) => {
      if (!path) return;
      try {
        const res = await cachedGet<{ items: CoreNotification[] }>(path, opts);
        setItems(res.items);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить уведомления");
      } finally {
        setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const refreshAll = useCallback(async () => {
    await Promise.all([load({ force: true }), refreshUnread()]);
  }, [load, refreshUnread]);

  // Экран уведомлений — первое, куда приходят из пуша: обновляем при возврате.
  useAppResume(refreshAll);

  useTaskDeepLink(setOpenTaskId);
  const closeTask = useCallback(() => setOpenTaskId(null), []);
  useBackDismiss(!!openTaskId, closeTask);

  const hasUnread = items.some((n) => !n.read_at);

  async function markAll() {
    if (!orgId || marking || !hasUnread) return;
    setMarking(true);
    try {
      await api.post(`/orgs/${orgId}/notifications`, { all: true });
      // Разобрано целиком — в шторке ОС висеть больше нечему.
      syncReadState({ unread: 0 });
      await Promise.all([load({ force: true }), refreshUnread()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отметить прочитанными");
    } finally {
      setMarking(false);
    }
  }

  async function openNotification(n: CoreNotification) {
    if (!orgId) return;
    // Задачу открываем в любом случае: сбой отметки прочтения не должен блокировать.
    if (n.entity_type === "task" && n.entity_id) setOpenTaskId(n.entity_id);
    if (!n.read_at) {
      try {
        await api.post(`/orgs/${orgId}/notifications`, { ids: [n.id] });
        // Тег тот же, что у пуша: уведомление об этой задаче уходит из шторки.
        if (n.entity_id) syncReadState({ tag: `v2-${n.entity_type}-${n.entity_id}` });
        const readAt = new Date().toISOString();
        const markRead = (list: CoreNotification[]) =>
          list.map((x) => (x.id === n.id ? { ...x, read_at: readAt } : x));
        setItems(markRead);
        // Та же правка в кэше: иначе возврат на экран воскресит непрочитанное.
        if (path) patch<{ items: CoreNotification[] }>(path, (prev) => ({ items: markRead(prev.items) }));
        await refreshUnread();
      } catch {
        // молча: уведомление останется непрочитанным, попробуем в следующий раз
      }
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <h1 className="flex-1 font-heading text-lg font-semibold tracking-tight">Уведомления</h1>
        <button
          onClick={() => void markAll()}
          disabled={!hasUnread || marking}
          className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-muted-foreground active:bg-muted disabled:opacity-40"
        >
          <CheckCheck className="size-4" />
          Прочитать все
        </button>
      </header>

      <PullToRefresh onRefresh={refreshAll} className="px-2 py-2">
        {error && (
          <div className="mx-2 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <span className="min-w-0 flex-1">{error}</span>
            <button onClick={() => void load({ force: true })} className="shrink-0 font-medium underline">
              Повторить
            </button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col gap-1 px-1" aria-hidden>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        )}

        {!loading && items.length === 0 && !error && (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <Bell className="size-8" />
            <p className="text-sm">Уведомлений пока нет</p>
          </div>
        )}

        {items.map((n) => {
          const line = notificationLine(n);
          return (
          <button
            key={n.id}
            onClick={() => void openNotification(n)}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-xl px-3 py-3 text-left active:bg-muted/60",
              !n.read_at && "bg-muted/40",
            )}
          >
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm leading-snug">
                {line.actor && <span className="font-medium">{line.actor} </span>}
                {line.action}
                {line.entity && <span className="font-medium"> «{line.entity}»</span>}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {new Date(n.created_at).toLocaleString("ru-RU", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </span>
          </button>
          );
        })}
      </PullToRefresh>

      <TaskSheet
        taskId={openTaskId}
        onClose={closeTask}
        // Экран показывает уведомления, а не задачи: правка поля его не меняет.
        // Перечитываем только когда задач стало больше.
        onChanged={(change) => {
          if (change.type === "reload") void load({ force: true });
        }}
      />
    </div>
  );
}
