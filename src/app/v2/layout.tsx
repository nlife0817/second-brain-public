"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Clock,
  FolderKanban,
  Plus,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { CreateProjectDialog } from "@/components/v2/CreateProjectDialog";
import { GlobalSearch } from "@/components/v2/GlobalSearch";
import { OrgOnboarding } from "@/components/v2/OrgOnboarding";
import { TaskSheet } from "@/components/v2/TaskSheet";
import { Avatar } from "@/components/v2/bits";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

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
  return (
    <Link
      href={href}
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

export default function V2Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const {
    ready,
    metaLoading,
    error,
    needsOnboarding,
    me,
    orgs,
    orgId,
    orgName,
    orgRole,
    projects,
    unreadCount,
    bootstrap,
    switchOrg,
    refreshUnread,
    refreshProjects,
  } = useV2Store();
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTaskId, setSearchTaskId] = useState<string | null>(null);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const t = setInterval(() => void refreshUnread(), 30_000);
    return () => clearInterval(t);
  }, [refreshUnread]);

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

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Загрузка…
      </div>
    );
  }
  if (needsOnboarding && me) {
    return <OrgOnboarding />;
  }
  if (error || !me) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{error ?? "Нет доступа"}</p>
        <Link className="text-sm text-primary underline" href="/">
          Вернуться в старый интерфейс
        </Link>
      </div>
    );
  }

  const isGuest = orgRole === "guest";

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
                    if (o.id !== orgId) void switchOrg(o.id);
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
            {/* Оболочка появляется сразу после /me, справочники доезжают следом:
                пока они в пути — скелет, а не «проектов нет». */}
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

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} onPickTask={setSearchTaskId} />
      {/* Карточка задачи, открытая из поиска: страницы держат собственную. */}
      <TaskSheet
        taskId={searchTaskId}
        onClose={() => setSearchTaskId(null)}
        onChanged={() => void refreshProjects()}
      />
    </div>
  );
}
