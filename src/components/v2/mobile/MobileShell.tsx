"use client";

// Мобильная оболочка v2: нижний таб-бар вместо десктопного сайдбара.
// Данные — тот же useV2Store; bootstrap и опрос непрочитанного запускает
// родительский /v2/layout.tsx (он отдаёт мобильным путям детей без сайдбара,
// но его эффекты работают для обеих оболочек).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Bell, CheckCircle2, Clock, FolderKanban, Settings } from "lucide-react";
import { OrgOnboarding } from "@/components/v2/OrgOnboarding";
import { InstallPrompt, PushNudge } from "./InstallPrompt";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/v2/m/my", label: "Мои", icon: CheckCircle2 },
  { href: "/v2/m/inbox", label: "Входящие", icon: Bell },
  { href: "/v2/m/projects", label: "Проекты", icon: FolderKanban },
  { href: "/v2/m/time", label: "Время", icon: Clock },
  { href: "/v2/m/settings", label: "Настройки", icon: Settings },
] as const;

export function MobileShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, needsOnboarding, error, me, unreadCount } = useV2Store();

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

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        Загрузка…
      </div>
    );
  }
  if (needsOnboarding && me) return <OrgOnboarding />;
  if (error || !me) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm text-destructive">{error ?? "Нет доступа"}</p>
        <Link className="text-sm text-primary underline" href="/v2/my?desktop">
          Открыть полную версию
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-background pt-[env(safe-area-inset-top)] text-foreground">
      <InstallPrompt />
      <PushNudge />
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      <nav className="grid shrink-0 grid-cols-5 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-col items-center gap-0.5 pb-1.5 pt-2",
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
              <span className={cn("text-[10px] leading-none", active && "font-medium")}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
