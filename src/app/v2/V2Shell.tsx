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
  CheckCircle2,
  Clock,
  GripVertical,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
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
  SIDEBAR_VIEWPORT_CAP,
  SidebarResizer,
  useNarrowViewport,
  type SidebarSize,
} from "@/components/v2/SidebarResizer";
import { useRowDrag } from "@/components/v2/tasks/use-row-drag";
import { api } from "@/lib/core/client";
import {
  SIDEBAR_COLLAPSED_COOKIE,
  SIDEBAR_COLLAPSED_COOKIE_MAX_AGE,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_WIDTH_COOKIE,
} from "@/lib/core/keys";
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
import type { ProjectWithMeta, UserBrief } from "@/lib/core/types";
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
  collapsed = false,
  action,
  handle,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  active: boolean;
  /** Свёрнутая панель: остаётся только значок, подпись уходит в title. */
  collapsed?: boolean;
  /**
   * Действие у правого края строки — появляется по наведению (`group/nav`).
   * В свёрнутой панели не рисуется: там на значок и подпись-то места нет.
   */
  action?: React.ReactNode;
  /**
   * Ручка перетаскивания. Рисуется соседом ссылки (кнопка внутри `<a>`
   * недопустима), а место ей выбирает вызывающий: у проектов она встаёт поверх
   * значка, потому что третий элемент в строке распирает узкую панель.
   */
  handle?: React.ReactNode;
}) {
  const [intent, setIntent] = useState(false);
  const withAction = !collapsed && (!!action || !!handle);
  const link = (
    <Link
      href={href}
      prefetch={intent ? true : false}
      onMouseEnter={() => setIntent(true)}
      onFocus={() => setIntent(true)}
      onTouchStart={() => setIntent(true)}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center rounded-lg py-1.5 text-sm transition-colors",
        collapsed ? "relative justify-center px-0" : "gap-2.5 px-2.5",
        // Рядом с действием ссылка перестаёт быть всей строкой — иначе она
        // выдавит кнопку за край панели длинным названием.
        withAction && "min-w-0 flex-1",
        // Активный пункт несёт акцентный цвет: на тонированном фоне панели
        // одна лишь серая подложка почти неразличима.
        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {icon}
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {badge != null && badge > 0 && (
        // В свёрнутом виде число не помещается — от счётчика остаётся точка,
        // но сам факт «здесь есть новое» теряться не должен.
        <span
          className={cn(
            "font-semibold leading-none",
            collapsed
              ? "absolute right-1 top-0.5 size-2 rounded-full bg-primary"
              : "rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground",
          )}
        >
          {!collapsed && (badge > 99 ? "99+" : badge)}
        </span>
      )}
    </Link>
  );

  if (!withAction) return link;
  // Действие — сосед ссылки, а не её потомок: <a> внутри <a> недопустим.
  // Общая обёртка нужна ради одного состояния наведения на всю строку.
  return (
    <span className="group/nav relative flex items-center">
      {handle}
      {link}
      {action}
    </span>
  );
}

/**
 * Настройки проекта прямо из сайдбара — карандаш у правого края строки.
 * Префетч, как и у самой строки, включается намерением: экран настроек
 * динамический, тянуть его для каждого проекта при монтировании незачем.
 */
function ProjectSettingsLink({ projectId, name }: { projectId: string; name: string }) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      href={`/v2/projects/${projectId}/settings`}
      prefetch={intent ? true : false}
      onMouseEnter={() => setIntent(true)}
      onFocus={() => setIntent(true)}
      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/nav:opacity-100"
      title="Настройки проекта"
      aria-label={`Настройки проекта «${name}»`}
    >
      <Pencil className="size-3.5" />
    </Link>
  );
}

export function V2Shell({
  state,
  onboardingUser,
  initialCollapsed = false,
  initialWidth = SIDEBAR_DEFAULT_WIDTH,
  children,
}: {
  state: V2BootstrapResult["state"];
  onboardingUser: UserBrief | null;
  /** Свёрнут ли сайдбар — считано из cookie серверным layout. */
  initialCollapsed?: boolean;
  /** Ширина развёрнутого сайдбара — оттуда же и уже приведённая к диапазону. */
  initialWidth?: number;
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
  const [userCollapsed, setUserCollapsed] = useState(initialCollapsed);
  const [width, setWidth] = useState(initialWidth);
  // Пока тянут границу, переход ширины снят: с ним панель едет за курсором с
  // задержкой в полкадра и выглядит резиновой.
  const [resizing, setResizing] = useState(false);
  // Узкое окно сворачивает панель само, но человек вправе это перебить —
  // тогда до следующего сворачивания решает он, а не размер окна.
  const [expandedOnNarrow, setExpandedOnNarrow] = useState(false);
  // Перестановка не доехала до сервера — панель уже вернулась к прежнему
  // порядку, но молчать об этом нельзя: человек видел бы, как строка «сама»
  // прыгает назад.
  const [orderError, setOrderError] = useState<string | null>(null);
  const migrated = useRef(false);

  const narrow = useNarrowViewport();
  // Дальше по разметке фигурирует только итоговое состояние: свернул ли панель
  // человек или её свернуло узкое окно — на вид строки это не влияет.
  const collapsed = userCollapsed || (narrow && !expandedOnNarrow);

  // Значения читает серверный layout — иначе следующая полная загрузка вернула
  // бы панель к прежнему размеру. Авто-сворачивание на узком окне сюда не
  // попадает намеренно: это подстройка под текущее окно, а не выбор человека.
  const persist = useCallback((next: SidebarSize) => {
    const age = `path=/; max-age=${SIDEBAR_COLLAPSED_COOKIE_MAX_AGE}; samesite=lax`;
    document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${next.collapsed ? "1" : "0"}; ${age}`;
    document.cookie = `${SIDEBAR_WIDTH_COOKIE}=${next.width}; ${age}`;
  }, []);

  // Зеркало размера: клавиатура и двойной клик правят его и тут же требуют
  // закрепить, а состояние к этому моменту ещё прежнее — из замыкания рендера
  // в cookie уехало бы значение до правки.
  const sizeRef = useRef<SidebarSize>({ collapsed: initialCollapsed, width: initialWidth });

  const applySize = useCallback((next: SidebarSize) => {
    sizeRef.current = next;
    setWidth(next.width);
    setUserCollapsed(next.collapsed);
    setExpandedOnNarrow(!next.collapsed);
  }, []);

  const commitSize = useCallback(() => {
    persist(sizeRef.current);
  }, [persist]);

  const toggleCollapsed = useCallback(() => {
    applySize({ collapsed: !collapsed, width: sizeRef.current.width });
    commitSize();
  }, [applySize, collapsed, commitSize]);

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

  /**
   * Новый порядок проектов: сначала на экране, потом на сервере, с откатом —
   * как правка справочника статусов. Список берём из стора, а не из замыкания
   * рендера: сюда приходят из обработчика указателя, и замыкание может отстать.
   *
   * На сервер уходит порядок целиком (`PUT …/projects/order`); закрытые и
   * архивные проекты в списке не участвуют, их места сервис сохраняет сам.
   */
  const reorderProjects = useCallback(
    (from: number, to: number) => {
      const { projects: snapshot, orgId, setProjects } = storeApi.getState();
      const next = [...snapshot];
      const [moved] = next.splice(from, 1);
      if (!moved || !orgId) return;
      next.splice(to, 0, moved);
      setProjects(next);
      setOrderError(null);
      void (async () => {
        try {
          const rows = await api.put<ProjectWithMeta[]>(`/orgs/${orgId}/projects/order`, {
            order: next.map((p) => p.id),
          });
          storeApi.getState().setProjects(rows);
        } catch (e) {
          storeApi.getState().setProjects(snapshot);
          setOrderError(e instanceof Error ? e.message : "Не удалось сохранить порядок");
        }
      })();
    },
    [storeApi],
  );
  const projectDrag = useRowDrag(store.projects.length, reorderProjects);

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

  const { me, orgId, orgName, orgRole, projects, unreadCount, metaLoading } = store;
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
  // Порядок общий для организации, поэтому и двигает его тот, кто за неё
  // отвечает, — тот же порог, что у справочника статусов (`projects.order`
  // в policy.ts). Сервер проверяет это ещё раз: ручка здесь — удобство, а не
  // защита.
  const canOrderProjects = orgRole === "owner" || orgRole === "admin";

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside
        // Верхний предел повторён в CSS, а не только в жесте: окно сужают и без
        // перетаскивания, и панель обязана подобраться сама, не отдав список
        // задач под полоску в пару сантиметров.
        style={collapsed ? undefined : { width: `min(${width}px, ${SIDEBAR_VIEWPORT_CAP})` }}
        className={cn(
          "relative flex shrink-0 flex-col border-r border-border bg-sidebar",
          collapsed && "w-14",
          !resizing && "transition-[width] duration-150",
        )}
      >
        <SidebarResizer
          width={width}
          collapsed={collapsed}
          onChange={applySize}
          onCommit={commitSize}
          onDraggingChange={setResizing}
        />
        {/* Название организации — просто заголовок. Переключение организаций
            переехало в «Настройки»: шапка панели не должна открывать меню. */}
        <div className={cn("flex items-center pb-2 pt-3", collapsed ? "flex-col gap-1 px-2" : "gap-2 px-3")}>
          {!collapsed && (
            <>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary to-orange-300 text-xs font-bold text-primary-foreground shadow-accent">
                {orgName.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{orgName}</span>
            </>
          )}
          <button
            onClick={toggleCollapsed}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title={collapsed ? "Развернуть панель" : "Свернуть панель"}
            aria-label={collapsed ? "Развернуть панель" : "Свернуть панель"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>

        <div className="px-2 pb-1">
          <button
            onClick={() => setSearchOpen(true)}
            title={collapsed ? "Поиск" : undefined}
            className={cn(
              "flex w-full items-center rounded-lg border border-border py-1.5 text-sm text-muted-foreground hover:bg-muted/60",
              collapsed ? "justify-center px-0" : "gap-2 px-2.5",
            )}
          >
            <Search className="size-4" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Поиск</span>
                <kbd className="rounded border border-border px-1 text-[10px]">⌘K</kbd>
              </>
            )}
          </button>
        </div>

        <nav className="flex flex-col gap-0.5 px-2 py-1">
          <NavLink
            href="/v2/my"
            icon={<CheckCircle2 className="size-4" />}
            label="Мои задачи"
            active={pathname.startsWith("/v2/my")}
            collapsed={collapsed}
          />
          <NavLink
            href="/v2/tasks"
            icon={<ListChecks className="size-4" />}
            label="Все задачи"
            active={pathname.startsWith("/v2/tasks")}
            collapsed={collapsed}
          />
          <NavLink
            href="/v2/inbox"
            icon={<Bell className="size-4" />}
            label="Уведомления"
            badge={unreadCount}
            active={pathname.startsWith("/v2/inbox")}
            collapsed={collapsed}
          />
          <NavLink
            href="/v2/time"
            icon={<Clock className="size-4" />}
            label="Время"
            active={pathname.startsWith("/v2/time")}
            collapsed={collapsed}
          />
          {!isGuest && (
            <NavLink
              href="/v2/clients"
              icon={<Users className="size-4" />}
              label="Клиенты"
              active={pathname.startsWith("/v2/clients")}
              collapsed={collapsed}
            />
          )}
          {/* Настройки открыты всем ролям: состав разделов внутри решает
              владелец организации, а «уведомления на устройстве» нужны и гостю. */}
          <NavLink
            href="/v2/settings"
            icon={<Settings className="size-4" />}
            label="Настройки"
            active={pathname.startsWith("/v2/settings")}
            collapsed={collapsed}
          />
        </nav>

        <div className={cn("mt-2 flex items-center justify-between", collapsed ? "px-2" : "px-4")}>
          {!collapsed && (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Проекты
            </span>
          )}
          {!isGuest && (
            <button
              onClick={() => setCreateOpen(true)}
              className={cn(
                "rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground",
                collapsed && "mx-auto",
              )}
              title="Новый проект"
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-1.5">
          <div className={cn("flex flex-col gap-0.5", canOrderProjects && "select-none")}>
            {projects.map((p, i) => {
              const dragging = projectDrag.draggingId === p.id;
              return (
                <div
                  key={p.id}
                  style={{
                    transform: `translate3d(0, ${projectDrag.shiftOf(i)}px, 0)`,
                    zIndex: dragging ? 10 : undefined,
                  }}
                  className={cn(
                    "relative rounded-lg",
                    dragging && "bg-sidebar shadow-md ring-1 ring-ring",
                    // Соседи расступаются плавно, но переход живёт только на
                    // время перетаскивания: оставить его к моменту отпускания —
                    // значит проиграть возврат из уже применённого сдвига.
                    // Наведение им тоже не нужно, иначе подсветка бежит за
                    // курсором.
                    !projectDrag.idle && !dragging && "pointer-events-none transition-transform duration-150 ease-out",
                  )}
                >
                  <NavLink
                    href={`/v2/projects/${p.id}`}
                    icon={
                      <ProjectIcon
                        name={p.icon}
                        color={p.color}
                        // Значок уступает место ручке: третьему элементу в строке
                        // узкая панель места не даёт.
                        className={cn(
                          "size-3.5",
                          canOrderProjects && !collapsed && "group-hover/nav:opacity-0",
                          dragging && "opacity-0",
                        )}
                      />
                    }
                    label={p.name}
                    active={pathname.startsWith(`/v2/projects/${p.id}`)}
                    collapsed={collapsed}
                    // Порог тот же, что был у шестерёнки в шапке проекта: смотреть
                    // настройки может любой участник, а править — editor и админ.
                    action={
                      (p.my_role === "admin" || p.my_role === "editor") && (
                        <ProjectSettingsLink projectId={p.id} name={p.name} />
                      )
                    }
                    // В свёрнутой панели перетаскивания нет: от строки остался
                    // один значок, и ручке негде появиться, не закрыв его совсем.
                    handle={
                      canOrderProjects && !collapsed ? (
                        <button
                          {...projectDrag.handlers(i, p.id)}
                          // touch-none обязателен: без него палец прокручивает
                          // панель вместо перетаскивания.
                          className={cn(
                            "absolute left-2.5 top-1/2 z-10 -translate-y-1/2 touch-none text-muted-foreground opacity-0 group-hover/nav:opacity-100 focus-visible:opacity-100",
                            dragging ? "cursor-grabbing opacity-100" : "cursor-grab",
                          )}
                          title="Перетащите, чтобы изменить порядок (или ↑/↓)"
                          aria-label={`Переместить проект «${p.name}»`}
                        >
                          <GripVertical className="size-3.5" />
                        </button>
                      ) : undefined
                    }
                  />
                </div>
              );
            })}
            {orderError && !collapsed && (
              <p className="px-2.5 py-1 text-[11px] text-destructive">{orderError}</p>
            )}
            {/* Справочники доезжают заново только при смене организации: пока
                они в пути — скелет, а не «проектов нет». */}
            {projects.length === 0 && metaLoading && (
              <div className="flex flex-col gap-1 px-2.5 py-2" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-4 animate-pulse rounded bg-muted" />
                ))}
              </div>
            )}
            {projects.length === 0 && !metaLoading && !collapsed && (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">
                {isGuest ? "Вам ещё не открыли ни одного проекта" : "Пока нет проектов"}
              </p>
            )}
          </div>
        </div>

        {/* Подсказка про уведомления — абзац текста: в панели шириной со значок
            он вылезает за её край. */}
        {!collapsed && <PushPrompt />}

        <div className={cn("border-t border-border py-2", collapsed ? "px-1" : "px-3")}>
          <AccountMenu me={me} orgRole={orgRole} compact={collapsed} />
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
