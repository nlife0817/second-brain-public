"use client";

// Меню аккаунта в подвале сайдбара: кто вошёл, куда перейти и как выйти.
// До него аватар с именем был просто подписью — сменить аккаунт было нельзя
// вообще ниоткуда.

import Link from "next/link";
import { useState } from "react";
import { Bell, LogOut, Smartphone } from "lucide-react";
import { Avatar } from "@/components/v2/bits";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/core/session";
import type { OrgRole, UserBrief } from "@/lib/core/types";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Сотрудник",
  guest: "Гость",
};

export function AccountMenu({
  me,
  orgRole,
  compact = false,
}: {
  me: UserBrief;
  orgRole: OrgRole | null;
  /** Свёрнутый сайдбар: остаётся один аватар, подпись уходит в title. */
  compact?: boolean;
}) {
  const [signingOut, setSigningOut] = useState(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            title={compact ? me.name || me.email : undefined}
            className={cn(
              "flex w-full items-center rounded-lg py-1 text-left hover:bg-muted/60",
              compact ? "justify-center px-0" : "gap-2 px-1",
            )}
          >
            <Avatar user={me} size="md" />
            {!compact && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{me.name || me.email}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {orgRole ? ROLE_LABELS[orgRole] : me.email}
                </span>
              </span>
            )}
          </button>
        }
      />
      <DropdownMenuContent className="w-60" align="start">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{me.name || me.email}</p>
          <p className="truncate text-xs text-muted-foreground">{me.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/v2/settings/notifications" />}>
          <Bell className="size-4" />
          Уведомления
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/v2/m/my?mobile" />}>
          <Smartphone className="size-4" />
          Мобильная версия
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={signingOut}
          // closeOnClick=false: пункт остаётся видимым, пока идёт отписка
          // устройства и запрос выхода — иначе меню схлопывается и клик
          // выглядит так, будто ничего не произошло.
          closeOnClick={false}
          onClick={() => {
            setSigningOut(true);
            void signOut();
          }}
        >
          <LogOut className="size-4" />
          {signingOut ? "Выходим…" : "Выйти"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
