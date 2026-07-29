"use client";

// Push в браузере на компьютере: предложение включить и всплывающая карточка
// в открытой вкладке.
//
// Инфраструктура доставки одна на все оболочки (sw.js + core.push_subscriptions),
// не хватало ровно двух вещей: разрешение никто не спрашивал (тумблер лежал в
// настройках организации, куда гость не заходит), а открытая вкладка узнавала
// об изменениях только из опроса раз в 30 секунд.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDismissFlag } from "@/components/v2/mobile/hooks";
import { enablePushNotifications, getPushState } from "@/lib/notifications/client";

const V2_PUSH = { subscribeUrl: "/api/v2/push/subscribe" };

const NUDGE_DISMISS_KEY = "sb.v2.desktopPushDismissedAt";
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Предложение включить уведомления. Показывается только когда разрешение ещё
 * не спрашивали: «отказано» переспрашивать бессмысленно — браузер второй раз
 * диалог не покажет, снимать блокировку человек идёт в настройки сайта.
 */
export function PushPrompt() {
  const [dismissed, dismiss] = useDismissFlag(NUDGE_DISMISS_KEY, DISMISS_TTL_MS);
  const [askable, setAskable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    void getPushState()
      .then((state) => {
        if (cancelled) return;
        setAskable(state.supported && state.permission === "default" && !state.subscribed);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dismissed]);

  if (dismissed || !askable) return null;

  async function enable() {
    setBusy(true);
    try {
      await enablePushNotifications(V2_PUSH);
      setAskable(false);
    } catch {
      // Отказ в системном диалоге — не настаиваем: тумблер остаётся в разделе
      // уведомлений.
      dismiss();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-2 mb-2 rounded-lg border border-border bg-muted/40 p-2.5">
      <div className="flex items-start gap-2">
        <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-xs leading-snug">
          Уведомления о задачах и комментариях прямо в браузере
        </p>
        <button
          onClick={dismiss}
          className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Скрыть"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <Button size="sm" className="mt-2 w-full" onClick={() => void enable()} disabled={busy}>
        {busy ? "Включаем…" : "Включить"}
      </Button>
    </div>
  );
}

// ---- Всплывающие карточки ----------------------------------------------------------------

interface ToastItem {
  id: number;
  title: string;
  body: string;
  url: string;
}

const TOAST_TTL_MS = 8000;
const MAX_TOASTS = 3;

/** Сообщение из service worker: то же событие, что ушло в шторку браузера. */
interface PushMessage {
  type?: string;
  title?: string;
  body?: string;
  url?: string;
}

/**
 * Карточка в углу, когда push пришёл в уже открытую вкладку. Системное
 * уведомление в этот момент тоже показывается (браузер не даёт «тихих»
 * пушей), но глаз человека — в приложении, и изменение должно быть видно там
 * же, а не только в шторке ОС.
 */
export function PushToasts({ onNotification }: { onNotification?: () => void }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let seq = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function onMessage(event: MessageEvent) {
      const data = event.data as PushMessage | null;
      if (!data || data.type !== "sb:push") return;
      // Счётчик в сайдбаре не должен ждать следующего тика опроса.
      onNotification?.();
      const id = ++seq;
      setToasts((prev) => [
        ...prev.slice(-(MAX_TOASTS - 1)),
        {
          id,
          title: data.title || "Обновление",
          body: data.body || "",
          url: data.url || "/v2/inbox",
        },
      ]);
      timers.push(setTimeout(() => remove(id), TOAST_TTL_MS));
    }

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      for (const t of timers) clearTimeout(t);
    };
  }, [onNotification, remove]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border bg-popover p-3 shadow-lg"
        >
          <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <button
            className="min-w-0 flex-1 text-left"
            onClick={() => {
              remove(toast.id);
              router.push(toast.url);
            }}
          >
            <span className="block truncate text-sm font-medium">{toast.title}</span>
            {toast.body && (
              <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{toast.body}</span>
            )}
          </button>
          <button
            onClick={() => remove(toast.id)}
            className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Закрыть"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
