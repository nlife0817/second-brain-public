"use client";

// Мобильная оболочка v2: нижний таб-бар вместо десктопного сайдбара.
// Данные — тот же useV2Store; bootstrap и опрос непрочитанного запускает
// родительский /v2/layout.tsx (он отдаёт мобильным путям детей без сайдбара,
// но его эффекты работают для обеих оболочек).

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Bell, CheckCircle2, Clock, CloudOff, FolderKanban, Settings } from "lucide-react";
import { OrgOnboarding } from "@/components/v2/OrgOnboarding";
import { SignOutButton } from "@/components/v2/SignOutButton";
import { Button } from "@/components/ui/button";
import { InstallPrompt, PushNudge } from "./InstallPrompt";
import { TASK_DEEPLINK_EVENT, useAppResume, useOnline } from "./hooks";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/v2/m/my", label: "Мои", icon: CheckCircle2 },
  { href: "/v2/m/inbox", label: "Входящие", icon: Bell },
  { href: "/v2/m/projects", label: "Проекты", icon: FolderKanban },
  { href: "/v2/m/time", label: "Время", icon: Clock },
  { href: "/v2/m/settings", label: "Настройки", icon: Settings },
] as const;

function TabBar({ pathname, unreadCount }: { pathname: string; unreadCount: number }) {
  return (
    <nav className="grid shrink-0 grid-cols-5 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center gap-0.5 pb-1.5 pt-2 transition-colors active:bg-muted/60",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span className="relative">
              <Icon className="size-5" />
              {tab.href === "/v2/m/inbox" && unreadCount > 0 && (
                <span className="absolute -right-2.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </span>
            <span className={cn("text-[10px] leading-none", active && "font-medium")}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Каркас списка вместо строки «Загрузка…»: оболочка появляется сразу,
 *  и переход из пуша не выглядит как пустой экран. */
function ShellSkeleton() {
  return (
    <div className="flex h-dvh flex-col bg-background pt-[env(safe-area-inset-top)]" aria-busy>
      <div className="flex shrink-0 items-center border-b border-border px-4 py-3">
        <span className="h-5 w-32 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex flex-1 flex-col gap-2 px-4 py-3" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <TabBar pathname="/v2/m/my" unreadCount={0} />
    </div>
  );
}

export function MobileShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, needsOnboarding, error, me, unreadCount, bootstrap, refreshUnread } = useV2Store();
  const online = useOnline();

  // Тап по уведомлению, когда приложение уже открыто: service worker передаёт
  // адрес сообщением, а не перезагружает окно — переход мгновенный и не сбивает
  // введённый текст. Экран нужной вкладки открывает карточку сам.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function onMessage(e: MessageEvent) {
      const data = e.data as { type?: string; url?: string } | null;
      if (!data) return;
      // Push пришёл в открытое приложение: счётчик и бейдж обновляем сразу,
      // не дожидаясь возврата на экран или следующего опроса.
      if (data.type === "sb:push") {
        void refreshUnread();
        return;
      }
      if (data.type !== "sb:navigate" || typeof data.url !== "string") return;
      const target = new URL(data.url, window.location.origin);
      const taskId = target.searchParams.get("task");
      if (target.pathname !== window.location.pathname) {
        router.push(`${target.pathname}${target.search}`);
        return;
      }
      if (taskId) window.dispatchEvent(new CustomEvent(TASK_DEEPLINK_EVENT, { detail: taskId }));
      else void refreshUnread();
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router, refreshUnread]);

  // Пока оболочка смонтирована, документ помечен как мобильный. Правила из
  // globals.css должны доставать и до порталов: карточка задачи, диалоги и
  // выпадающие списки рендерятся в body, вне этого дерева.
  useEffect(() => {
    document.documentElement.setAttribute("data-mobile-v2", "");
    return () => document.documentElement.removeAttribute("data-mobile-v2");
  }, []);

  // Возврат в приложение: счётчик и бейдж не должны показывать вчерашнее.
  useAppResume(refreshUnread);

  // Бейдж на иконке установленного приложения синхронен счётчику в UI:
  // push выставляет его из sw.js, а визит в приложение — отсюда.
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge || !nav.clearAppBadge) return;
    void (unreadCount > 0 ? nav.setAppBadge(unreadCount) : nav.clearAppBadge()).catch(() => {});
  }, [unreadCount]);

  if (!ready) return <ShellSkeleton />;
  if (needsOnboarding && me) return <OrgOnboarding />;
  if (error || !me) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-destructive">{error ?? "Нет доступа"}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void bootstrap()}>
            Повторить
          </Button>
          {/* Вошли не тем аккаунтом — другого выхода с этого экрана нет. */}
          <SignOutButton />
        </div>
        <Link className="text-sm text-primary underline" href="/v2/my?desktop">
          Полная версия
        </Link>
      </div>
    );
  }

  return (
    <div
      data-mobile-shell
      className="flex h-dvh flex-col bg-background pt-[env(safe-area-inset-top)] text-foreground"
    >
      {!online && (
        <div className="flex shrink-0 items-center justify-center gap-1.5 bg-muted px-4 py-1.5 text-xs text-muted-foreground">
          <CloudOff className="size-3.5" />
          Нет сети — данные могут устареть
        </div>
      )}
      <InstallPrompt />
      <PushNudge />
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      <TabBar pathname={pathname} unreadCount={unreadCount} />
    </div>
  );
}
