"use client";

// Фильтры календаря на телефоне: лист снизу с быстрыми чипами, галочками
// внешних календарей и — под спойлером — тем же конструктором условий, что на
// десктопе.
//
// Чип и конструктор правят одни и те же `groups` в `ViewStore`: чип собирает
// группу «одно поле через ИЛИ» (`toggleQuickFilterValue`), конструктор видит её
// как обычную группу и может дополнить. Свой параллельный набор состояний для
// телефона означал бы, что один и тот же срез показывает на двух экранах разное.

import { useState } from "react";
import { CalendarCog, ChevronDown, Search, X } from "lucide-react";
import Link from "next/link";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { PRIORITY_LABELS } from "@/components/v2/bits";
import { FilterBuilder } from "@/components/v2/tasks/FilterBuilder";
import { api } from "@/lib/core/client";
import { invalidate } from "@/lib/core/query";
import type { CalendarAccountWithCalendars, CalendarBrief } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { useViewStore } from "@/lib/core/view-store";
import {
  ME_VALUE,
  NONE_VALUE,
  SHOW_VALUE,
  quickFilterValues,
  toggleQuickFilterValue,
  type FilterField,
} from "@/lib/core/views";
import { cn } from "@/lib/utils";
import { DEFAULT_EVENT_COLOR } from "./parts";

const CHIP = "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border px-3 text-[13px]";
const CHIP_EMPTY = "border-border text-muted-foreground active:bg-muted";
const CHIP_SET = "border-primary/40 bg-primary/10 font-medium text-primary";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
  );
}

export function CalendarFilterSheet({
  open,
  onOpenChange,
  accounts,
  setAccounts,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: CalendarAccountWithCalendars[];
  setAccounts: React.Dispatch<React.SetStateAction<CalendarAccountWithCalendars[]>>;
  onError: (message: string | null) => void;
}) {
  const { statuses, projects } = useV2Store();
  const groups = useViewStore((s) => s.groups);
  const setGroups = useViewStore((s) => s.setGroups);
  const search = useViewStore((s) => s.search);
  const setSearch = useViewStore((s) => s.setSearch);
  const [advanced, setAdvanced] = useState(false);

  const toggle = (field: FilterField, value: string) =>
    setGroups(toggleQuickFilterValue(groups, field, value));
  const picked = (field: FilterField, value: string) => quickFilterValues(groups, field).includes(value);

  /** Галочка видимости календаря — оптимистично: тап обязан срабатывать сразу. */
  const toggleCalendar = async (cal: CalendarBrief) => {
    const next = !cal.visible;
    const apply = (visible: boolean) =>
      setAccounts((prev) =>
        prev.map((a) => ({
          ...a,
          calendars: a.calendars.map((c) => (c.id === cal.id ? { ...c, visible } : c)),
        })),
      );
    apply(next);
    try {
      await api.patch(`/calendar/calendars/${cal.id}`, { visible: next });
      invalidate("/calendar/accounts");
      onError(null);
    } catch (e) {
      apply(cal.visible);
      onError(e instanceof Error ? e.message : "Не удалось переключить календарь");
    }
  };

  const conditions = groups.reduce((n, g) => n + g.conditions.length, 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[88dvh] gap-0 rounded-t-2xl pb-[max(env(safe-area-inset-bottom),0.75rem)]"
      >
        <div className="flex items-center gap-2 px-4 pt-3">
          <SheetTitle className="flex-1">Фильтры</SheetTitle>
          {(conditions > 0 || search) && (
            <button
              onClick={() => {
                setGroups([]);
                setSearch("");
              }}
              className="rounded-lg px-2 py-1.5 text-sm text-muted-foreground active:bg-muted"
            >
              Сбросить
            </button>
          )}
          <button
            onClick={() => onOpenChange(false)}
            className="-mr-2 rounded-lg p-2 text-muted-foreground active:bg-muted"
            aria-label="Закрыть"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-2 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию…"
              className="h-10 w-full rounded-xl border border-input bg-transparent pl-8 pr-8 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Очистить поиск"
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-2 text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <Section title="Быстро">
            <button
              onClick={() => toggle("assignee", ME_VALUE)}
              className={cn(CHIP, picked("assignee", ME_VALUE) ? CHIP_SET : CHIP_EMPTY)}
            >
              Мои задачи
            </button>
            <button
              onClick={() => toggle("assignee", NONE_VALUE)}
              className={cn(CHIP, picked("assignee", NONE_VALUE) ? CHIP_SET : CHIP_EMPTY)}
            >
              Без исполнителя
            </button>
            {/* Завершённые и архив скрыты всегда — показать их можно только этим
                условием (см. VISIBILITY_FIELDS в views.ts). */}
            <button
              onClick={() => toggle("done", SHOW_VALUE)}
              className={cn(CHIP, picked("done", SHOW_VALUE) ? CHIP_SET : CHIP_EMPTY)}
            >
              Показать готовые
            </button>
            <button
              onClick={() => toggle("archive", SHOW_VALUE)}
              className={cn(CHIP, picked("archive", SHOW_VALUE) ? CHIP_SET : CHIP_EMPTY)}
            >
              Показать архив
            </button>
          </Section>

          {projects.length > 0 && (
            <Section title="Проекты">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => toggle("project", p.id)}
                  className={cn(CHIP, picked("project", p.id) ? CHIP_SET : CHIP_EMPTY)}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color ?? DEFAULT_EVENT_COLOR }}
                  />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </Section>
          )}

          {statuses.length > 0 && (
            <Section title="Статус">
              {statuses.map((s) => (
                <button
                  key={s.id}
                  onClick={() => toggle("status", s.id)}
                  className={cn(CHIP, picked("status", s.id) ? CHIP_SET : CHIP_EMPTY)}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color ?? DEFAULT_EVENT_COLOR }}
                  />
                  <span className="truncate">{s.name}</span>
                </button>
              ))}
            </Section>
          )}

          <Section title="Приоритет">
            {(Object.keys(PRIORITY_LABELS) as (keyof typeof PRIORITY_LABELS)[])
              .filter((p) => p !== "none")
              .map((p) => (
                <button
                  key={p}
                  onClick={() => toggle("priority", p)}
                  className={cn(CHIP, picked("priority", p) ? CHIP_SET : CHIP_EMPTY)}
                >
                  <span className={cn("size-2 shrink-0 rounded-full", PRIORITY_LABELS[p].dot)} />
                  {PRIORITY_LABELS[p].label}
                </button>
              ))}
          </Section>

          <section className="flex flex-col gap-1.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Внешние календари
            </h3>
            {accounts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Не подключены. Встречи из Google Calendar можно показывать рядом с задачами — они
                останутся только для чтения.
              </p>
            ) : (
              accounts.map((account) => (
                <div key={account.id} className="flex flex-col gap-0.5">
                  <span className="truncate text-[11px] text-muted-foreground">
                    {account.label || (account.provider === "google" ? "Google Calendar" : "Подписка ICS")}
                  </span>
                  {account.sync_error && (
                    <span className="text-[11px] text-destructive">{account.sync_error}</span>
                  )}
                  {account.calendars.map((cal) => (
                    <button
                      key={cal.id}
                      onClick={() => void toggleCalendar(cal)}
                      className="flex items-center gap-2.5 rounded-lg px-1 py-2 text-left text-sm active:bg-muted"
                    >
                      <span
                        className={cn(
                          "size-4 shrink-0 rounded border",
                          cal.visible ? "border-transparent" : "border-border",
                        )}
                        style={
                          cal.visible
                            ? { backgroundColor: cal.color_override ?? cal.color ?? DEFAULT_EVENT_COLOR }
                            : undefined
                        }
                      />
                      <span className={cn("min-w-0 flex-1 truncate", !cal.visible && "text-muted-foreground")}>
                        {cal.name || "Без названия"}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
            {/* Подключение календарей живёт только в полной версии — ?desktop
                нужен, чтобы proxy не увёл телефон обратно на мобильный экран. */}
            <Link
              href="/v2/settings/calendars?desktop"
              className="flex items-center gap-1.5 pt-1 text-sm text-primary"
            >
              <CalendarCog className="size-4" />
              {accounts.length === 0 ? "Подключить календарь" : "Настройки календарей"}
            </Link>
          </section>

          <section className="border-t border-border pt-2">
            <button
              onClick={() => setAdvanced((v) => !v)}
              className="flex w-full items-center gap-1.5 py-1 text-sm text-muted-foreground"
            >
              <ChevronDown className={cn("size-4 transition-transform", advanced && "rotate-180")} />
              Условия целиком
              {conditions > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums">
                  {conditions}
                </span>
              )}
            </button>
            {advanced && (
              <div className="pt-1.5">
                <FilterBuilder />
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
