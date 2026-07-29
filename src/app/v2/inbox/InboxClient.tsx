"use client";

// Инбокс уведомлений: назначения, комментарии, смены статусов и сроков.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskSheet } from "@/components/v2/lazy";
import { api } from "@/lib/core/client";
import { cachedGet, patch, peek, seed } from "@/lib/core/query";
import type { CoreNotification } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

const KIND_LABELS: Record<string, string> = {
  assigned: "назначил(а) вам задачу",
  comment: "прокомментировал(а)",
  status_changed: "сменил(а) статус",
  completed: "завершил(а) задачу",
  due_changed: "изменил(а) срок",
  added_to_project: "добавил(а) вас в проект",
};

export function InboxClient({ initial }: { initial: CoreNotification[] }) {
  const { orgId, refreshUnread } = useV2Store();
  const [items, setItems] = useState<CoreNotification[]>(initial);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = orgId ? `/orgs/${orgId}/notifications` : null;

  // Список посчитан на сервере — кладём его в кэш вместо первого запроса.
  useEffect(() => {
    if (path) seed(path, { items: initial });
  }, [path, initial]);

  const load = useCallback(
    async (opts: { force?: boolean } = {}) => {
      if (!path) return;
      if (opts.force || peek(path) === undefined) setLoading(true);
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

  async function markAll() {
    if (!orgId) return;
    const previous = items;
    const readAt = new Date().toISOString();
    // Список гасим сразу: ответ сервера ничего не добавляет к тому, что мы уже
    // знаем, а ждать его — значит держать кнопку «думающей» лишнюю секунду.
    const markAllRead = (list: CoreNotification[]) =>
      list.map((x) => (x.read_at ? x : { ...x, read_at: readAt }));
    setItems(markAllRead);
    if (path) patch<{ items: CoreNotification[] }>(path, (prev) => ({ items: markAllRead(prev.items) }));
    try {
      await api.post(`/orgs/${orgId}/notifications`, { all: true });
      await refreshUnread();
    } catch (e) {
      setItems(previous);
      if (path) patch<{ items: CoreNotification[] }>(path, () => ({ items: previous }));
      setError(e instanceof Error ? e.message : "Не удалось отметить прочитанными");
    }
  }

  async function openNotification(n: CoreNotification) {
    if (!orgId) return;
    // Задачу открываем в любом случае: сбой отметки прочтения не должен блокировать.
    if (n.entity_type === "task" && n.entity_id) setOpenTaskId(n.entity_id);
    if (n.read_at) return;
    const readAt = new Date().toISOString();
    const markRead = (list: CoreNotification[]) =>
      list.map((x) => (x.id === n.id ? { ...x, read_at: readAt } : x));
    // Отметку ставим до запроса: она не зависит от ответа.
    setItems(markRead);
    // Та же правка в кэше: иначе возврат на экран воскресит непрочитанное.
    if (path) patch<{ items: CoreNotification[] }>(path, (prev) => ({ items: markRead(prev.items) }));
    try {
      await api.post(`/orgs/${orgId}/notifications`, { ids: [n.id] });
      await refreshUnread();
    } catch {
      // молча: уведомление останется непрочитанным, попробуем в следующий раз
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <h1 className="text-base font-semibold">Уведомления</h1>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => void markAll()}>
          <CheckCheck className="size-4" />
          Прочитать все
        </Button>
        {/* Настройки доставки живут рядом со списком: гостю раздел
            «Настройки» в сайдбаре не показан, а уведомления получает и он. */}
        <Button
          variant="ghost"
          size="icon-sm"
          title="Настройки уведомлений"
          render={<Link href="/v2/settings/notifications" />}
        >
          <Settings className="size-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-1">
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          {loading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
          {!loading && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <Bell className="size-8" />
              <p className="text-sm">Уведомлений пока нет</p>
            </div>
          )}
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => void openNotification(n)}
              className={cn(
                "flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                !n.read_at && "bg-muted/40",
              )}
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">
                  <span className="font-medium">{n.actor_name || "Кто-то"}</span>{" "}
                  {KIND_LABELS[n.kind] ?? n.kind}
                  {n.entity_title && <span className="font-medium"> «{n.entity_title}»</span>}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {new Date(n.created_at).toLocaleString("ru-RU", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <TaskSheet taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
    </div>
  );
}
