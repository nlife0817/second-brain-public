"use client";

// Клиентская часть оболочки v2: сайдбар, глобальные слои, опрос непрочитанного.
// Данные приходят готовыми из серверного рендера (`initial`) — стор наполняется
// синхронно, до первого чтения, поэтому серверная и клиентская разметка
// совпадают и «Загрузка…» на старте больше нет.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Clock,
  FolderKanban,
  ListChecks,
  Plus,
  Repeat,
  Search,
  Settings,
  Smartphone,
  Users,
} from "lucide-react";
import { CreateProjectDialog, GlobalSearch, OrgOnboarding, TaskSheet } from "@/components/v2/lazy";
import { GlobalTimer } from "@/components/v2/GlobalTimer";
import { Avatar } from "@/components/v2/bits";
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
  writeActiveOrgCookie,
  type V2InitialState,
} from "@/lib/core/ui-store";
import type { V2BootstrapResult } from "@/lib/core/bootstrap";
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

/**
 * Последнее наполнение стора. Модульная переменная, а не ref: гидрация обязана
 * произойти до первого чтения стора в этом же рендере, иначе клиент отрисует
 * пустой сайдбар поверх серверного и React сообщит о расхождении.
 */
let hydratedWith: V2InitialState | null = null;

function hydrateOnce(initial: V2InitialState | null): void {
  if (typeof window === "undefined" || !initial) return;
  if (hydratedWith === initial) return;
  hydratedWith = initial;
  useV2Store.getState().hydrate(initial);
}

export function V2Shell({
  initial,
  state,
  children,
}: {
  initial: V2InitialState | null;
  state: V2BootstrapResult["state"];
  children: React.ReactNode;
}) {
  // Синхронно, до чтения стора ниже. На сервере — no-op: модульный стор общий
  // для всех запросов, писать в него во время серверного рендера нельзя.
  hydrateOnce(initial);

  const pathname = usePathname();
  const router = useRouter();
  const store = useV2Store();
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTaskId, setSearchTaskId] = useState<string | null>(null);
  const migrated = useRef(false);

  // Серверный рендер видит пустой стор (писать в модульный синглтон во время
  // рендера сервера нельзя) — там источником служит `initial`. В браузере стор
  // уже наполнен теми же данными, поэтому разметка совпадает.
  const view: V2InitialState | null =
    initial === null
      ? null
      : store.ready && store.me && store.orgId && store.orgRole
        ? {
            me: store.me,
            orgs: store.orgs,
            orgId: store.orgId,
            orgName: store.orgName,
            orgRole: store.orgRole,
            projects: store.projects,
            statuses: store.statuses,
            tags: store.tags,
            members: store.members,
            fields: store.fields,
            unreadCount: store.unreadCount,
          }
        : initial;

  useEffect(() => {
    hydrateOnce(initial);
  }, [initial]);

  // Оболочка без серверных данных — редкость (гонка сессии), но экран в этом
  // случае должен наполниться сам, а не остаться пустым навсегда.
  useEffect(() => {
    if (!initial && state === "anonymous" && !useV2Store.getState().ready) {
      void useV2Store.getState().bootstrap();
    }
  }, [initial, state]);

  // Переезд активной организации из localStorage в cookie. Сервер выбрал
  // организацию по cookie; если её ещё нет, а в localStorage лежал другой
  // выбор — закрепляем его и перечитываем страницу уже для нужной организации.
  useEffect(() => {
    if (migrated.current || !initial) return;
    migrated.current = true;
    const cookie = readActiveOrgCookie();
    const legacy = takeLegacyActiveOrg();
    if (cookie === initial.orgId) return;
    const wanted = !cookie && legacy && initial.orgs.some((o) => o.id === legacy) ? legacy : initial.orgId;
    writeActiveOrgCookie(wanted);
    if (wanted !== initial.orgId) router.refresh();
  }, [initial, router]);

  useEffect(() => {
    const t = setInterval(() => void useV2Store.getState().refreshUnread(), 30_000);
    return () => clearInterval(t);
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

  if (state === "onboarding") {
    return <OrgOnboarding />;
  }
  if (!view) {
    // Сессии нет или она разъехалась с базой. Клиентский bootstrap выше мог
    // успеть починить состояние — тогда показываем его ошибку, а не заглушку.
    if (!store.ready) {
      return (
        <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
          Загрузка…
        </div>
      );
    }
    if (store.needsOnboarding) return <OrgOnboarding />;
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{store.error ?? "Нет доступа"}</p>
        <Link className="text-sm text-primary underline" href="/">
          Вернуться в старый интерфейс
        </Link>
      </div>
    );
  }

  const { me, orgs, orgId, orgName, orgRole, projects, unreadCount } = view;
  const isGuest = orgRole === "guest";
  const metaLoading = store.ready ? store.metaLoading : false;

  async function onSwitchOrg(nextId: string) {
    await useV2Store.getState().switchOrg(nextId);
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
                icon={<span className="size-2.5 rounded-sm" style={{ backgroundColor: p.color }} />}
                label={p.name}
                badge={p.open_task_count}
                active={pathname === `/v2/projects/${p.id}`}
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

        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Avatar user={me} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{me.name || me.email}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {orgRole === "owner" ? "Владелец" : orgRole === "admin" ? "Администратор" : orgRole === "member" ? "Сотрудник" : "Гость"}
              </p>
            </div>
            <Link
              href="/v2/m/my?mobile"
              title="Мобильная версия"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Smartphone className="size-4" />
            </Link>
            <Link
              href="/"
              title="Старый интерфейс"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <FolderKanban className="size-4" />
            </Link>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>

      <GlobalTimer />
      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} onPickTask={setSearchTaskId} />
      {/* Карточка задачи, открытая из поиска: страницы держат собственную. */}
      <TaskSheet
        taskId={searchTaskId}
        onClose={() => setSearchTaskId(null)}
        onChanged={() => void useV2Store.getState().refreshProjects()}
      />
    </div>
  );
}
