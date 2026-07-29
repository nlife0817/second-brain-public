"use client";

// Клиентская часть оболочки v2: сайдбар, глобальные слои, опрос непрочитанного.
// Данные приходят готовыми из серверного рендера (`initial`) — стор наполняется
// синхронно, до первого чтения, поэтому серверная и клиентская разметка
// совпадают и «Загрузка…» на старте больше нет.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Clock,
  ListChecks,
  Plus,
  Repeat,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { CreateProjectDialog, GlobalSearch, OrgOnboarding, TaskSheet } from "@/components/v2/lazy";
import { AccountMenu } from "@/components/v2/AccountMenu";
import { GlobalTimer } from "@/components/v2/GlobalTimer";
import { PushPrompt, PushToasts } from "@/components/v2/PushDesktop";
import { SignOutButton } from "@/components/v2/SignOutButton";
import { ProjectIcon } from "@/components/v2/project-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  readActiveOrgCookie,
  takeLegacyActiveOrg,
  useV2Store,
  useV2StoreApi,
  writeActiveOrgCookie,
} from "@/lib/core/ui-store";
import { reportTimezone } from "@/lib/core/timezone";
import { usePollWhenVisible } from "@/lib/core/use-poll";
import { syncReadState } from "@/lib/notifications/client";
import type { V2BootstrapResult } from "@/lib/core/bootstrap";
import type { UserBrief } from "@/lib/core/types";
import { cn } from "@/lib/utils";

/**
 * Ссылка сайдбара с префетчем по намерению.
 *
 * Экраны v2 стали динамическими (данные считаются на сервере под конкретного
 * пользователя), а такие маршруты Next по умолчанию префетчит только до
 * ближайшего loading-барьера — то есть без данных. `prefetch` включается на
 * наведении: полный маршрут вместе с данными уезжает в кэш роутера, и переход
 * происходит мгновенно. Префетчить всё сразу при монтировании нельзя — это
 * десяток серверных рендеров на каждое открытие любого экрана.
 */
function NavLink({
  href,
  icon,
  label,
  badge,
  active,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  active: boolean;
}) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      href={href}
      prefetch={intent ? true : false}
      onMouseEnter={() => setIntent(true)}
      onFocus={() => setIntent(true)}
      onTouchStart={() => setIntent(true)}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {badge != null && badge > 0 && (
        <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

export function V2Shell({
  state,
  onboardingUser,
  children,
}: {
  state: V2BootstrapResult["state"];
  onboardingUser: UserBrief | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const storeApi = useV2StoreApi();
  // Стор наполнен провайдером и на сервере, и в браузере — читаем напрямую.
  const store = useV2Store();
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTaskId, setSearchTaskId] = useState<string | null>(null);
  const migrated = useRef(false);

  // Оболочка без серверных данных — редкость (гонка сессии), но экран в этом
  // случае должен наполниться сам, а не остаться пустым навсегда.
  useEffect(() => {
    if (state === "anonymous" && !storeApi.getState().ready) {
      void storeApi.getState().bootstrap();
    }
  }, [state, storeApi]);

  // Переезд активной организации из localStorage в cookie. Сервер выбрал
  // организацию по cookie; если её ещё нет, а в localStorage лежал другой
  // выбор — закрепляем его и перечитываем страницу уже для нужной организации.
  useEffect(() => {
    if (migrated.current) return;
    const { orgId, orgs } = storeApi.getState();
    if (!orgId) return;
    migrated.current = true;
    const cookie = readActiveOrgCookie();
    const legacy = takeLegacyActiveOrg();
    if (cookie === orgId) return;
    const wanted = !cookie && legacy && orgs.some((o) => o.id === legacy) ? legacy : orgId;
    writeActiveOrgCookie(wanted);
    if (wanted !== orgId) router.refresh();
  }, [storeApi, router]);

  usePollWhenVisible(
    useCallback(() => void storeApi.getState().refreshUnread(), [storeApi]),
    30_000,
  );

  // Непрочитанных не осталось — возможно, их разобрали на телефоне. Убираем
  // из шторки этого браузера то, что там ещё висит.
  const unread = store.unreadCount;
  useEffect(() => {
    if (unread === 0) syncReadState({ unread: 0 });
  }, [unread]);

  // Часовой пояс устройства нужен напоминаниям о сроках и тихим часам.
  useEffect(() => {
    void reportTimezone();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Мобильные роуты /v2/m/* рисуют собственную оболочку (MobileShell, нижний
  // таб-бар) — десктопный сайдбар им не нужен. Хуки выше уже отработали:
  // гидрация и опрос непрочитанного общие для обеих оболочек.
  if (pathname === "/v2/m" || pathname.startsWith("/v2/m/")) {
    return <>{children}</>;
  }

  if (state === "onboarding" || store.needsOnboarding) {
    return <OrgOnboarding user={onboardingUser} />;
  }

  const { me, orgs, orgId, orgName, orgRole, projects, unreadCount, metaLoading } = store;
  if (!me || !orgId || !orgRole) {
    // Сессии нет или она разъехалась с базой. Клиентский bootstrap выше мог
    // успеть починить состояние — тогда показываем его ошибку, а не заглушку.
    if (!store.ready) {
      return (
        <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
          Загрузка…
        </div>
      );
    }
    // Тупик: чаще всего сюда попадают, войдя не тем аккаунтом Google.
    // Без выхода отсюда некуда деться.
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{store.error ?? "Нет доступа"}</p>
        <SignOutButton label="Выйти и войти другим аккаунтом" />
      </div>
    );
  }

  const isGuest = orgRole === "guest";

  async function onSwitchOrg(nextId: string) {
    await storeApi.getState().switchOrg(nextId);
    // Данные страницы считает сервер по cookie — без обновления серверного
    // рендера экран остался бы на задачах прежней организации.
    router.refresh();
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="px-2 pb-2 pt-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
                    {orgName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">{orgName}</span>
                  <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              }
            />
            <DropdownMenuContent className="w-56">
              {orgs.map((o) => (
                <DropdownMenuItem
                  key={o.id}
                  onClick={() => {
                    if (o.id !== orgId) void onSwitchOrg(o.id);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  {o.id === orgId && <Check className="size-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="px-2 pb-1">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted/60"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Поиск</span>
            <kbd className="rounded border border-border px-1 text-[10px]">⌘K</kbd>
          </button>
        </div>

        <nav className="flex flex-col gap-0.5 px-2 py-1">
          <NavLink
            href="/v2/my"
            icon={<CheckCircle2 className="size-4" />}
            label="Мои задачи"
            active={pathname.startsWith("/v2/my")}
          />
          <NavLink
            href="/v2/tasks"
            icon={<ListChecks className="size-4" />}
            label="Все задачи"
            active={pathname.startsWith("/v2/tasks")}
          />
          <NavLink
            href="/v2/inbox"
            icon={<Bell className="size-4" />}
            label="Уведомления"
            badge={unreadCount}
            active={pathname.startsWith("/v2/inbox")}
          />
          <NavLink
            href="/v2/time"
            icon={<Clock className="size-4" />}
            label="Время"
            active={pathname.startsWith("/v2/time")}
          />
          {!isGuest && (
            <NavLink
              href="/v2/recurring"
              icon={<Repeat className="size-4" />}
              label="Повторы"
              active={pathname.startsWith("/v2/recurring")}
            />
          )}
          {!isGuest && (
            <NavLink
              href="/v2/clients"
              icon={<Users className="size-4" />}
              label="Клиенты"
              active={pathname.startsWith("/v2/clients")}
            />
          )}
          {!isGuest && (
            <NavLink
              href="/v2/settings"
              icon={<Settings className="size-4" />}
              label="Настройки"
              active={pathname.startsWith("/v2/settings")}
            />
          )}
        </nav>

        <div className="mt-2 flex items-center justify-between px-4">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Проекты
          </span>
          {!isGuest && (
            <button
              onClick={() => setCreateOpen(true)}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Новый проект"
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-1.5">
          <div className="flex flex-col gap-0.5">
            {projects.map((p) => (
              <NavLink
                key={p.id}
                href={`/v2/projects/${p.id}`}
                icon={<ProjectIcon name={p.icon} color={p.color} className="size-3.5" />}
                label={p.name}
                badge={p.open_task_count}
                active={pathname.startsWith(`/v2/projects/${p.id}`)}
              />
            ))}
            {/* Справочники доезжают заново только при смене организации: пока
                они в пути — скелет, а не «проектов нет». */}
            {projects.length === 0 && metaLoading && (
              <div className="flex flex-col gap-1 px-2.5 py-2" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-4 animate-pulse rounded bg-muted" />
                ))}
              </div>
            )}
            {projects.length === 0 && !metaLoading && (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">
                {isGuest ? "Вам ещё не открыли ни одного проекта" : "Пока нет проектов"}
              </p>
            )}
          </div>
        </div>

        <PushPrompt />

        <div className="border-t border-border px-3 py-2">
          <AccountMenu me={me} orgRole={orgRole} />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>

      <PushToasts onNotification={() => void storeApi.getState().refreshUnread()} />
      <GlobalTimer />
      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} onPickTask={setSearchTaskId} />
      {/* Карточка задачи, открытая из поиска: страницы держат собственную. */}
      <TaskSheet
        taskId={searchTaskId}
        onClose={() => setSearchTaskId(null)}
        onChanged={(change) => {
          // Оболочка списка задач не держит — ей важны только счётчики, и то
          // после подтверждения сервером.
          if (change.type === "patched" && !change.confirmed) return;
          void storeApi.getState().refreshProjects();
        }}
      />
    </div>
  );
}
