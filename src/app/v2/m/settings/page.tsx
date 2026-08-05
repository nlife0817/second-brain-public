"use client";

// Настройки на мобильном: профиль, организация, пуш-уведомления, установка.
// Администрирование (участники, приглашения, статусы, поля) — на десктопе.

import Link from "next/link";
import { Check, CheckCircle2, ChevronsUpDown, Download, Monitor, Smartphone } from "lucide-react";
import { Avatar } from "@/components/v2/bits";
import {
  DeliveryPreferences,
  NotificationKinds,
  ProjectMutes,
  PushTestButton,
  TelegramConnect,
} from "@/components/v2/NotificationSettings";
import { PasswordSection } from "@/components/v2/PasswordSection";
import { PushToggle } from "@/components/v2/PushToggle";
import { SignOutButton } from "@/components/v2/SignOutButton";
import { IosInstallSteps, useInstallState } from "@/components/v2/mobile/InstallPrompt";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useV2Store } from "@/lib/core/ui-store";

const ROLE_LABELS: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Сотрудник",
  guest: "Гость",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function MobileSettingsPage() {
  const { me, members, orgs, orgId, orgName, orgRole, switchOrg } = useV2Store();
  const { standalone, ios, canInstall, install } = useInstallState();

  if (!me) return null;

  // Задан ли пароль — из своей же строки в составе организации.
  const myMembership = members.find((m) => m.user_id === me.id);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center border-b border-border px-4 py-3">
        <h1 className="font-heading text-lg font-semibold tracking-tight">Настройки</h1>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <div className="flex flex-col gap-3">
          <Section title="Профиль">
            <div className="flex items-center gap-3">
              <Avatar user={me} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{me.name || me.email}</p>
                <p className="truncate text-xs text-muted-foreground">{me.email}</p>
              </div>
              {orgRole && (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {ROLE_LABELS[orgRole]}
                </span>
              )}
            </div>
          </Section>

          <Section title="Вход в систему">
            <PasswordSection hasPassword={myMembership?.has_password ?? true} />
          </Section>

          <Section title="Организация">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
                      {orgName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">{orgName}</span>
                    {orgs.length > 1 && <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />}
                  </button>
                }
              />
              <DropdownMenuContent className="w-64">
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
          </Section>

          <Section title="Уведомления на этом устройстве">
            <PushToggle />
            {!standalone && ios && (
              <p className="mt-2 text-xs text-muted-foreground">
                На iPhone уведомления работают только из установленного приложения — установите его ниже.
              </p>
            )}
            <div className="mt-3 border-t border-border pt-3">
              <PushTestButton />
            </div>
          </Section>

          <Section title="Telegram">
            <TelegramConnect />
          </Section>

          <Section title="Какие события присылать">
            <NotificationKinds />
          </Section>

          <Section title="Режим и сроки">
            <DeliveryPreferences />
          </Section>

          <Section title="Проекты">
            <ProjectMutes />
          </Section>

          <Section title="Приложение">
            <div className="flex flex-col gap-3 text-sm">
              {standalone ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  Установлено и открыто с домашнего экрана
                </p>
              ) : (
                <>
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Smartphone className="size-4" />
                    Открыто во вкладке браузера
                  </p>
                  {canInstall && (
                    <Button size="sm" className="w-full" onClick={() => void install()}>
                      <Download className="size-4" />
                      Установить приложение
                    </Button>
                  )}
                  {/* На iOS программной установки нет ни в каком браузере. */}
                  {!canInstall && ios && <IosInstallSteps />}
                  {!canInstall && !ios && (
                    <p className="text-xs text-muted-foreground">
                      Этот браузер не умеет устанавливать приложения. Откройте сайт в Chrome
                      (Android) или Safari (iPhone).
                    </p>
                  )}
                </>
              )}
              <Link
                href="/v2/my?desktop"
                className="flex items-center gap-2 text-primary underline underline-offset-2"
              >
                <Monitor className="size-4" />
                Полная версия (администрирование — там)
              </Link>
            </div>
          </Section>

          <Section title="Аккаунт">
            <p className="mb-3 text-sm text-muted-foreground">
              Выход снимет подписку на уведомления на этом устройстве.
            </p>
            <SignOutButton label="Выйти из аккаунта" className="w-full" />
          </Section>
        </div>
      </div>
    </div>
  );
}
