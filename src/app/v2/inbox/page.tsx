"use client";

// Инбокс уведомлений: назначения, комментарии, смены статусов и сроков.

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskSheet } from "@/components/v2/TaskSheet";
import { api } from "@/lib/core/client";
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

export default function InboxPage() {
  const { orgId, refreshUnread } = useV2Store();
  const [items, setItems] = useState<CoreNotification[]>([]);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await api.get<{ items: CoreNotification[] }>(`/orgs/${orgId}/notifications`);
      setItems(res.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить уведомления");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAll() {
    if (!orgId) return;
    try {
      await api.post(`/orgs/${orgId}/notifications`, { all: true });
      await Promise.all([load(), refreshUnread()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отметить прочитанными");
    }
  }

  async function openNotification(n: CoreNotification) {
    if (!orgId) return;
    // Задачу открываем в любом случае: сбой отметки прочтения не должен блокировать.
    if (n.entity_type === "task" && n.entity_id) setOpenTaskId(n.entity_id);
    if (!n.read_at) {
      try {
        await api.post(`/orgs/${orgId}/notifications`, { ids: [n.id] });
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
        await refreshUnread();
      } catch {
        // молча: уведомление останется непрочитанным, попробуем в следующий раз
      }
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
