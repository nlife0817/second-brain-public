"use client";

// Экран «Календари»: подключить Google, подписаться на ICS-ссылку, выбрать, какие
// календари показывать, обновить вручную, отключить.
//
// Внешние события правке не подлежат нигде, поэтому и здесь у них нет ни одной
// кнопки: наши таблицы — кэш чужого источника (см. lib/core/calendars.ts).

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/core/client";
import { invalidate } from "@/lib/core/query";
import type { CalendarAccountWithCalendars, CalendarBrief } from "@/lib/core/types";
import { cn } from "@/lib/utils";

const DEFAULT_COLOR = "#7c8ba1";

/** Что показать вместо технического кода из адресной строки. */
const ERRORS: Record<string, string> = {
  denied: "Доступ к календарю не выдан — на экране Google нужно нажать «Разрешить».",
  oauth: "Подключение не удалось: заход к Google оборвался. Попробуйте ещё раз.",
  state: "Подключение не удалось: ответ Google не относится к начатому здесь заходу.",
  exchange: "Google не выдал доступ к календарю. Подробности — в тексте ошибки у подключения ниже.",
  nokey: "Не задан ключ шифрования CALENDAR_TOKEN_KEY — без него подключение невозможно.",
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function formatMoment(iso: string | null): string {
  if (!iso) return "ещё не обновлялся";
  const date = new Date(iso);
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CalendarsClient({
  initialAccounts,
  keyConfigured,
}: {
  initialAccounts: CalendarAccountWithCalendars[];
  keyConfigured: boolean;
}) {
  const params = useSearchParams();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<null | "ics" | "sync">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Причина неудачи приезжает параметром из роута возврата: он редиректит сюда
  // и своего интерфейса не имеет.
  const queryError = useMemo(() => {
    const code = params.get("error");
    return code ? (ERRORS[code] ?? "Подключение не удалось.") : null;
  }, [params]);
  const connected = params.get("connected") === "1";

  const shown = error ?? queryError;

  /** Общий разбор ответа роутов: они отдают уже пересчитанный список. */
  const applyResult = (result: { accounts: CalendarAccountWithCalendars[]; report?: { errors: string[] } }) => {
    setAccounts(result.accounts);
    invalidate("/calendar");
    const errors = result.report?.errors ?? [];
    setError(errors.length > 0 ? errors.join("; ") : null);
    setNotice(errors.length > 0 ? null : "Календари обновлены.");
  };

  const addIcs = async () => {
    if (!url.trim()) return;
    setBusy("ics");
    setError(null);
    setNotice(null);
    try {
      applyResult(
        await api.post<{ accounts: CalendarAccountWithCalendars[]; report: { errors: string[] } }>(
          "/calendar/accounts",
          { url },
        ),
      );
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подписаться");
    } finally {
      setBusy(null);
    }
  };

  const syncNow = async () => {
    setBusy("sync");
    setError(null);
    setNotice(null);
    try {
      applyResult(
        await api.post<{ accounts: CalendarAccountWithCalendars[]; report: { errors: string[] } }>(
          "/calendar/sync",
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (account: CalendarAccountWithCalendars) => {
    setError(null);
    setNotice(null);
    // Оптимистично: строка исчезает под курсором, при отказе возвращается.
    setAccounts((prev) => prev.filter((a) => a.id !== account.id));
    try {
      await api.del(`/calendar/accounts/${account.id}`);
      invalidate("/calendar");
    } catch (e) {
      setAccounts(initialAccounts);
      setError(e instanceof Error ? e.message : "Не удалось отключить");
    }
  };

  const toggleCalendar = async (accountId: string, cal: CalendarBrief) => {
    const apply = (visible: boolean) =>
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === accountId
            ? { ...a, calendars: a.calendars.map((c) => (c.id === cal.id ? { ...c, visible } : c)) }
            : a,
        ),
      );
    apply(!cal.visible);
    try {
      await api.patch(`/calendar/calendars/${cal.id}`, { visible: !cal.visible });
      invalidate("/calendar");
    } catch (e) {
      apply(cal.visible);
      setError(e instanceof Error ? e.message : "Не удалось переключить календарь");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <Link
          href="/v2/settings"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="К настройкам"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="font-heading text-xl font-semibold tracking-tight">Календари</h1>
        <span className="flex-1" />
        {accounts.length > 0 && (
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void syncNow()}>
            {busy === "sync" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Обновить
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {!keyConfigured && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <p>
                Не задан <code>CALENDAR_TOKEN_KEY</code>. Он шифрует токен доступа и приватную ссылку
                подписки — без него подключить календарь нельзя. Ключ генерируется командой{" "}
                <code>openssl rand -hex 32</code> и живёт в <code>deploy/.env</code>.
              </p>
            </div>
          )}

          {shown && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {shown}
            </div>
          )}
          {(notice || connected) && !shown && (
            <div className="rounded-xl border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
              {notice ?? "Календарь подключён."}
            </div>
          )}

          <Section
            title="Google Calendar"
            description="Встречи будут видны на календаре задач рядом с самими задачами. Это отдельное разрешение: вход в приложение его не даёт, а календарь остаётся доступным только для чтения — изменить встречу можно там, где она создана."
          >
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              disabled={!keyConfigured}
              render={<Link href="/api/auth/google-calendar" />}
            >
              <CalendarDays className="size-4" />
              Подключить Google Calendar
            </Button>
          </Section>

          <Section
            title="Подписка по ссылке"
            description="Любой календарь, который умеет отдавать файл .ics: Outlook, Яндекс, Apple, расписания. Ссылка секретна — по ней календарь читается целиком, поэтому мы храним её в зашифрованном виде и наружу не отдаём."
          >
            <div className="flex flex-wrap gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addIcs();
                }}
                placeholder="https://…/basic.ics"
                className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring"
              />
              <Button size="sm" disabled={busy !== null || !url.trim() || !keyConfigured} onClick={() => void addIcs()}>
                {busy === "ics" ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                Подписаться
              </Button>
            </div>
          </Section>

          <Section
            title="Подключено"
            description={
              accounts.length === 0
                ? undefined
                : "Галочка убирает календарь с полотна, не отключая аккаунт: «Праздники» и чужой рабочий календарь приезжают вместе с рабочим, а нужны не всегда."
            }
          >
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Пока ничего не подключено.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {accounts.map((account) => (
                  <div key={account.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {account.provider === "google" ? (
                        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <Link2 className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {account.label || (account.provider === "google" ? "Google Calendar" : "Подписка ICS")}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatMoment(account.last_sync_at)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => void disconnect(account)}
                      >
                        <Trash2 className="size-3.5" />
                        Отключить
                      </Button>
                    </div>

                    {account.sync_error && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                        <span>{account.sync_error}</span>
                      </p>
                    )}

                    <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
                      {account.calendars.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Календари появятся после первого обновления.
                        </p>
                      ) : (
                        account.calendars.map((cal) => (
                          <button
                            key={cal.id}
                            onClick={() => void toggleCalendar(account.id, cal)}
                            className="flex items-center gap-2 rounded-md px-1 py-1 text-left text-xs transition-colors hover:bg-muted"
                          >
                            <span
                              className={cn(
                                "size-3 shrink-0 rounded-[3px] border",
                                cal.visible ? "border-transparent" : "border-border",
                              )}
                              style={
                                cal.visible
                                  ? { backgroundColor: cal.color_override ?? cal.color ?? DEFAULT_COLOR }
                                  : undefined
                              }
                            />
                            <span className={cn("flex-1 truncate", !cal.visible && "text-muted-foreground")}>
                              {cal.name || "Без названия"}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {cal.visible ? "видно" : "скрыт"}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <p className="px-1 text-[11px] text-muted-foreground">
            Календари обновляются сами примерно раз в полчаса. Записи внешнего календаря задачами не
            становятся: их видно на полотне, можно открыть и посмотреть детали, но правятся они только
            в своём календаре.
          </p>
        </div>
      </div>
    </div>
  );
}
