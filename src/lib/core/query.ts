"use client";

// Клиентский кэш GET-запросов v2.
//
// Зачем: экраны тянули свои данные заново при каждом открытии — переход
// «Мои задачи» → «Все задачи» → назад показывал «Загрузка…» трижды и трижды
// ходил в базу за одним и тем же. Здесь ответ живёт между переходами, а
// повторное открытие экрана рисуется мгновенно и обновляется в фоне.
//
// Данные первого рендера приходят с сервера (`initial`) — они и садятся в кэш,
// поэтому на холодной загрузке запроса не будет вовсе.
//
// SSR: модуль-синглтон общий для всех запросов сервера, поэтому писать в него
// во время серверного рендера нельзя — в мультитенантном приложении это утечка
// между организациями. Все записи идут либо из эффектов, либо под проверкой
// `typeof window`.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./client";

/** Сколько ответ считается свежим: в этом окне повторный заход не ходит в сеть. */
const FRESH_MS = 30_000;

interface Entry {
  data?: unknown;
  error?: string;
  /** Момент, когда данные легли в кэш. */
  at: number;
  /** Запрос в полёте — второй потребитель того же пути подхватывает его. */
  inflight?: Promise<unknown>;
}

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function notify(path: string): void {
  const set = listeners.get(path);
  if (!set) return;
  for (const fn of set) fn();
}

function subscribe(path: string, fn: () => void): () => void {
  let set = listeners.get(path);
  if (!set) {
    set = new Set();
    listeners.set(path, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(path);
  };
}

/** Кладёт готовое значение в кэш — используется для данных серверного рендера. */
export function seed<T>(path: string, data: T): void {
  if (!isBrowser()) return;
  entries.set(path, { data, at: Date.now() });
  notify(path);
}

/** Текущее значение без похода в сеть (undefined, если пути нет в кэше). */
export function peek<T>(path: string): T | undefined {
  if (!isBrowser()) return undefined;
  return entries.get(path)?.data as T | undefined;
}

/**
 * Правит закэшированное значение на месте — для оптимистичных обновлений.
 * Без этого правка жила бы только в состоянии экрана и терялась при возврате.
 */
export function patch<T>(path: string, updater: (prev: T) => T): void {
  if (!isBrowser()) return;
  const entry = entries.get(path);
  if (!entry || entry.data === undefined) return;
  entries.set(path, { ...entry, data: updater(entry.data as T) });
  notify(path);
}

/**
 * Сбрасывает кэш. Без аргумента — целиком (смена организации), с префиксом —
 * только затронутые пути (например, все списки задач после мутации).
 */
export function invalidate(prefix?: string): void {
  if (!isBrowser()) return;
  if (prefix === undefined) {
    const paths = [...entries.keys()];
    entries.clear();
    for (const p of paths) notify(p);
    return;
  }
  for (const path of [...entries.keys()]) {
    if (path.startsWith(prefix)) {
      entries.delete(path);
      notify(path);
    }
  }
}

/**
 * GET через кэш. Параллельные вызовы одного пути делят один запрос — иначе
 * экран и оболочка, которым нужен один список, дублировали бы поход в базу.
 */
export function cachedGet<T>(path: string, opts: { force?: boolean } = {}): Promise<T> {
  const entry = entries.get(path);
  if (entry?.inflight) return entry.inflight as Promise<T>;
  if (!opts.force && entry && entry.data !== undefined && Date.now() - entry.at < FRESH_MS) {
    return Promise.resolve(entry.data as T);
  }

  const inflight = api
    .get<T>(path)
    .then((data) => {
      entries.set(path, { data, at: Date.now() });
      notify(path);
      return data;
    })
    .catch((err: unknown) => {
      const message = err instanceof ApiError || err instanceof Error ? err.message : "Ошибка запроса";
      // Прежние данные не выбрасываем: мигнувшая сеть не должна опустошать экран.
      const prev = entries.get(path);
      entries.set(path, { data: prev?.data, at: prev?.at ?? 0, error: message });
      notify(path);
      throw err;
    });

  entries.set(path, { ...entry, at: entry?.at ?? 0, inflight });
  return inflight;
}

/**
 * Прогрев кэша по намерению (наведение на ссылку). Ошибки глотаем: префетч —
 * догадка, а не действие пользователя.
 */
export function prefetch(path: string): void {
  if (!isBrowser()) return;
  void cachedGet(path).catch(() => {});
}

export interface QueryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  /** Принудительно перечитать (после мутации). */
  refresh: () => Promise<void>;
  /** Локальная правка данных экрана и кэша разом. */
  update: (updater: (prev: T) => T) => void;
}

/**
 * Данные экрана: серверный рендер отдаёт `initial`, дальше живёт кэш.
 *
 * `initial` — самые свежие данные на момент монтирования (их только что
 * посчитал сервер), поэтому запроса на старте нет: значение просто садится в
 * кэш. Повторное открытие того же экрана рисуется из кэша мгновенно.
 */
export function useQuery<T>(
  path: string | null,
  opts: { initial?: T } = {},
): QueryResult<T> {
  const { initial } = opts;
  // Первый рендер обязан совпасть с серверным: берём ровно то, что отдал сервер.
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean }>(
    () => ({ data: initial, error: null, loading: initial === undefined && path !== null }),
  );

  // Данные серверного рендера сажаем в кэш один раз на монтирование пути:
  // повторно — только когда сервер прислал новый объект (клиентская навигация).
  const seededFor = useRef<{ path: string | null; value: unknown }>({ path: null, value: undefined });
  if (isBrowser() && path && initial !== undefined) {
    const stamp = seededFor.current;
    if (stamp.path !== path || stamp.value !== initial) {
      seededFor.current = { path, value: initial };
      entries.set(path, { data: initial, at: Date.now() });
    }
  }

  const sync = useCallback(() => {
    if (!path) return;
    const entry = entries.get(path);
    setState({
      data: entry?.data as T | undefined,
      error: entry?.error ?? null,
      loading: entry?.data === undefined && entry?.error === undefined,
    });
  }, [path]);

  useEffect(() => {
    if (!path) return;
    const unsubscribe = subscribe(path, sync);
    sync();
    // Свежий кэш (в том числе только что посаженный `initial`) сети не требует.
    void cachedGet<T>(path).catch(() => {});
    return unsubscribe;
  }, [path, sync]);

  const refresh = useCallback(async () => {
    if (!path) return;
    try {
      await cachedGet<T>(path, { force: true });
    } catch {
      // Ошибка уже разложена по подписчикам через кэш.
    }
  }, [path]);

  const update = useCallback(
    (updater: (prev: T) => T) => {
      if (!path) return;
      patch<T>(path, updater);
    },
    [path],
  );

  return { data: state.data, loading: state.loading, error: state.error, refresh, update };
}
