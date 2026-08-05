"use client";

// Подключённые внешние календари и их события за окно полотна. Общий хук
// десктопного календаря и мобильного: два запроса с одинаковыми ключами кэша и
// одинаковой мягкой обработкой отказа — своя копия на втором экране разошлась бы
// с первой при первой же правке.
//
// Ошибка наружу отдаётся мягко: внешний слой — дополнение к задачам, и упавший
// синк не повод прятать календарь целиком.

import { useEffect, useState } from "react";
import type { DayRange } from "./calendar";
import { cachedGet } from "./query";
import type { CalendarAccountWithCalendars, CalendarEventRow } from "./types";

export interface ExternalCalendars {
  accounts: CalendarAccountWithCalendars[];
  /** Наружу — ради оптимистичного переключения галочки видимости. */
  setAccounts: React.Dispatch<React.SetStateAction<CalendarAccountWithCalendars[]>>;
  events: CalendarEventRow[];
  externalError: string | null;
}

export function useExternalCalendars(range: DayRange): ExternalCalendars {
  const [accounts, setAccounts] = useState<CalendarAccountWithCalendars[]>([]);
  const [events, setEvents] = useState<CalendarEventRow[]>([]);
  const [externalError, setExternalError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    cachedGet<CalendarAccountWithCalendars[]>("/calendar/accounts")
      .then((list) => {
        if (alive) setAccounts(list);
      })
      .catch(() => {
        // Подключений нет или роут недоступен — полотно работает без слоя.
      });
    return () => {
      alive = false;
    };
  }, []);

  // Пока подключений нет, за событиями не ходим вовсе: это и лишний запрос на
  // каждое листание месяца, и полоса ошибки на экране у того, кто внешние
  // календари не подключал.
  const path = accounts.length === 0 ? null : `/calendar/events?from=${range.from}&to=${range.to}`;

  useEffect(() => {
    if (!path) return;
    let alive = true;
    cachedGet<CalendarEventRow[]>(path)
      .then((list) => {
        if (!alive) return;
        setEvents(list);
        setExternalError(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setEvents([]);
        setExternalError(e instanceof Error ? `Внешние календари: ${e.message}` : null);
      });
    return () => {
      alive = false;
    };
  }, [path]);

  return { accounts, setAccounts, events, externalError };
}
