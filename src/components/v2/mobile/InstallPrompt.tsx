"use client";

// Подсказки установки приложения и включения пушей.
//
// InstallPrompt: в мобильном браузере предлагает поставить PWA — на Android
// через перехваченный beforeinstallprompt (установка в один тап), на iOS
// программной установки нет, показываем инструкцию для Safari. Внутри уже
// установленного приложения баннер не рендерится.
//
// PushNudge: в установленном приложении мягко предлагает включить
// уведомления, пока разрешение не спрошено. На iPhone Push API существует
// только внутри установленного приложения — поэтому нудж живёт именно там.

import { useEffect, useState } from "react";
import { Bell, Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enablePushNotifications, getPushState } from "@/lib/notifications/client";

// Подписка v2 — авторизация по core-identity (см. PushToggle).
const V2_PUSH = { subscribeUrl: "/api/v2/push/subscribe" };

const INSTALL_DISMISS_KEY = "sb.v2.installPromptDismissedAt";
const NUDGE_DISMISS_KEY = "sb.v2.pushNudgeDismissedAt";
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS прикидывается макбуком, выдаёт себя мультитачем.
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || iPadOs;
}

function dismissedRecently(key: string): boolean {
  try {
    const at = window.localStorage.getItem(key);
    return !!at && Date.now() - Number(at) < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function markDismissed(key: string): void {
  try {
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
    // приватный режим — просто покажем снова в следующий раз
  }
}

export function InstallPrompt() {
  // До эффектов ничего не показываем: SSR не знает ни платформу, ни standalone.
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEffect(() => {
    if (isStandalone() || dismissedRecently(INSTALL_DISMISS_KEY)) return;
    if (isIos()) {
      // Отложенный тик: платформа читается из браузерного окружения, а рендер
      // с setState прямо в теле эффекта каскадил бы гидрацию (см. правило линта).
      const t = window.setTimeout(() => {
        setIos(true);
        setVisible(true);
      }, 0);
      return () => window.clearTimeout(t);
    }
    // Android/desktop Chrome: баннер только когда браузер готов ставить.
    function onPrompt(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!visible) return null;

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") setVisible(false);
    setDeferred(null);
  }

  function dismiss() {
    markDismissed(INSTALL_DISMISS_KEY);
    setVisible(false);
  }

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
        <button onClick={dismiss} className="p-1 text-muted-foreground" aria-label="Скрыть">
          <X className="size-4" />
        </button>
      </div>
      {ios && showIosSteps && (
        <ol className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            1. Откройте сайт в Safari и нажмите «Поделиться»
            <Share className="size-3.5 shrink-0" />
          </li>
          <li className="flex items-center gap-1.5">
            2. Выберите «На экран “Домой”»
            <SquarePlus className="size-3.5 shrink-0" />
          </li>
          <li>3. Откройте установленное приложение и включите уведомления в «Настройках»</li>
        </ol>
      )}
    </div>
  );
}

export function PushNudge() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Нудж — только внутри установленного приложения: в браузере включение
    // живёт в настройках, а на iOS вне standalone Push API вовсе нет.
    if (!isStandalone() || dismissedRecently(NUDGE_DISMISS_KEY)) return;
    void getPushState()
      .then((state) => {
        if (state.supported && state.permission === "default" && !state.subscribed) {
          setVisible(true);
        }
      })
      .catch(() => {});
  }, []);

  if (!visible) return null;

  async function enable() {
    setBusy(true);
    try {
      await enablePushNotifications(V2_PUSH);
      setVisible(false);
    } catch {
      // Отказ в системном диалоге — не настаиваем, тумблер остаётся в настройках.
      markDismissed(NUDGE_DISMISS_KEY);
      setVisible(false);
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    markDismissed(NUDGE_DISMISS_KEY);
    setVisible(false);
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
      <button onClick={dismiss} className="p-1 text-muted-foreground" aria-label="Скрыть">
        <X className="size-4" />
      </button>
    </div>
  );
}
