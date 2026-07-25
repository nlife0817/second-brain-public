"use client";

// Установка приложения и включение пушей.
//
// Android: Chrome решает, что сайт устанавливаем, и присылает
// beforeinstallprompt — иногда ещё до того, как React смонтирует слушатель.
// Поэтому событие ловит и придерживает крохотный скрипт в layout мобильной
// версии (см. install-capture.ts), а компоненты только читают отложенное
// событие. Без этого баннер «Установить» на части телефонов не появлялся
// вовсе — и выглядело это как отсутствие PWA.
//
// iOS: программной установки нет ни в каком виде, показываем инструкцию для
// Safari. Push API там существует только внутри установленного приложения —
// поэтому предложение включить уведомления живёт именно там.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Bell, Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enablePushNotifications, getPushState } from "@/lib/notifications/client";
import { useDismissFlag, useIos, useStandalone } from "./hooks";

// Подписка v2 — авторизация по core-identity (см. PushToggle).
const V2_PUSH = { subscribeUrl: "/api/v2/push/subscribe" };

const INSTALL_DISMISS_KEY = "sb.v2.installPromptDismissedAt";
const NUDGE_DISMISS_KEY = "sb.v2.pushNudgeDismissedAt";
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __sbInstallEvent?: BeforeInstallPromptEvent | null;
  }
}

const INSTALL_EVENTS = ["sb:installable", "sb:installed", "beforeinstallprompt", "appinstalled"];

function subscribeInstall(cb: () => void): () => void {
  for (const name of INSTALL_EVENTS) window.addEventListener(name, cb);
  return () => {
    for (const name of INSTALL_EVENTS) window.removeEventListener(name, cb);
  };
}

export interface InstallState {
  /** Открыто с домашнего экрана — ставить уже нечего. */
  standalone: boolean;
  /** iOS: установка только руками, через «Поделиться». */
  ios: boolean;
  /** Браузер готов поставить приложение по нажатию. */
  canInstall: boolean;
  /** Показывает системный диалог установки; true — пользователь согласился. */
  install: () => Promise<boolean>;
}

export function useInstallState(): InstallState {
  const standalone = useStandalone();
  const ios = useIos();
  const canInstall = useSyncExternalStore(
    subscribeInstall,
    () => !!window.__sbInstallEvent,
    () => false,
  );

  const install = useCallback(async () => {
    const evt = window.__sbInstallEvent;
    if (!evt) return false;
    // Отложенное событие одноразовое: показали диалог — забываем его в любом
    // случае, иначе кнопка останется висеть и вторым нажатием кинет ошибку.
    window.__sbInstallEvent = null;
    try {
      await evt.prompt();
      const choice = await evt.userChoice;
      return choice.outcome === "accepted";
    } catch {
      return false;
    } finally {
      window.dispatchEvent(new Event("sb:installable"));
    }
  }, []);

  return { standalone, ios, canInstall, install };
}

/** Инструкция для Safari: единственный способ установки на iPhone. */
export function IosInstallSteps({ className }: { className?: string }) {
  return (
    <ol className={className ?? "flex flex-col gap-1.5 text-xs text-muted-foreground"}>
      <li className="flex items-center gap-1.5">
        1. Откройте сайт в Safari и нажмите «Поделиться»
        <Share className="size-3.5 shrink-0" />
      </li>
      <li className="flex items-center gap-1.5">
        2. Выберите «На экран “Домой”»
        <SquarePlus className="size-3.5 shrink-0" />
      </li>
      <li>3. Откройте приложение с домашнего экрана и включите уведомления</li>
    </ol>
  );
}

export function InstallPrompt() {
  const { standalone, ios, canInstall, install } = useInstallState();
  const [dismissed, dismiss] = useDismissFlag(INSTALL_DISMISS_KEY, DISMISS_TTL_MS);
  const [showIosSteps, setShowIosSteps] = useState(false);

  // Нечего предлагать: уже установлено, скрыто пользователем или браузер
  // установку не поддерживает (десктоп, Firefox на Android и т.п.).
  if (standalone || dismissed || (!ios && !canInstall)) return null;

  return (
    <div className="shrink-0 border-b border-border bg-muted/40 px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <img src="/icons/icon-192.png" alt="" className="size-8 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight">Установите приложение</p>
          <p className="text-xs text-muted-foreground">Быстрый доступ и пуш-уведомления</p>
        </div>
        {ios ? (
          <Button size="sm" variant="outline" onClick={() => setShowIosSteps((v) => !v)}>
            Как?
          </Button>
        ) : (
          <Button size="sm" onClick={() => void install()}>
            Установить
          </Button>
        )}
        <button onClick={dismiss} className="-mr-1 p-2 text-muted-foreground" aria-label="Скрыть">
          <X className="size-4" />
        </button>
      </div>
      {ios && showIosSteps && <IosInstallSteps className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground" />}
    </div>
  );
}

export function PushNudge() {
  const standalone = useStandalone();
  const [dismissed, dismiss] = useDismissFlag(NUDGE_DISMISS_KEY, DISMISS_TTL_MS);
  const [askable, setAskable] = useState(false);
  const [busy, setBusy] = useState(false);

  // Разрешение читается асинхронно: getPushState ждёт готовности service
  // worker, синхронного снимка для useSyncExternalStore тут нет.
  const active = standalone && !dismissed;
  useEffect(() => {
    if (!active) return;
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
  }, [active]);

  if (!active || !askable) return null;

  async function enable() {
    setBusy(true);
    try {
      await enablePushNotifications(V2_PUSH);
      setAskable(false);
    } catch {
      // Отказ в системном диалоге — не настаиваем, тумблер остаётся в настройках.
      dismiss();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-2.5">
      <Bell className="size-5 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-sm leading-tight">
        Включить уведомления о задачах и комментариях?
      </p>
      <Button size="sm" onClick={() => void enable()} disabled={busy}>
        Включить
      </Button>
      <button onClick={dismiss} className="-mr-1 p-2 text-muted-foreground" aria-label="Скрыть">
        <X className="size-4" />
      </button>
    </div>
  );
}
