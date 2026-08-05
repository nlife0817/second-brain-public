"use client";

// Стор интерфейса v2: контекст организации + кэши справочников.
//
// Инстанс создаётся на запрос и раздаётся через React-контекст, а не живёт
// модульным синглтоном. Причина — серверный рендер: модульный стор общий для
// всех одновременных запросов сервера, и наполнить его данными пользователя
// значило бы показать их соседнему. Пер-запросный инстанс снимает и вторую
// проблему: экран, читающий стор при рендере, на сервере видит те же данные,
// что и в браузере, — без расхождения гидрации.

import { createContext, createElement, useContext, useEffect, useRef } from "react";
import { createStore, useStore } from "zustand";
import { api } from "./client";
import { invalidate } from "./query";
import { ACTIVE_ORG_COOKIE, ACTIVE_ORG_COOKIE_MAX_AGE, ACTIVE_ORG_LEGACY_KEY } from "./keys";
import type {
  CoreTag,
  CustomField,
  OrgMemberWithUser,
  OrgRole,
  OrgSummary,
  ProjectWithMeta,
  TaskStatus,
  UserBrief,
} from "./types";

interface MeResponse {
  user: UserBrief;
  orgs: OrgSummary[];
}

/** Справочники организации одним ответом — зеркало `OrgMeta` из bootstrap.ts. */
interface OrgMetaResponse {
  projects: ProjectWithMeta[];
  statuses: TaskStatus[];
  tags: CoreTag[];
  members: OrgMemberWithUser[];
  fields: CustomField[];
  unreadCount: number;
  activeTimer: ActiveTimer | null;
}

/** Активный таймер пользователя — зеркало `TimeEntryWithTask`. */
export interface ActiveTimer {
  id: string;
  task_id: string | null;
  started_at: string;
  ended_at: string | null;
  note: string;
  task_title: string | null;
}

/** Состояние оболочки, посчитанное на сервере. */
export interface V2InitialState extends OrgMetaResponse {
  me: UserBrief;
  orgs: OrgSummary[];
  orgId: string;
  orgName: string;
  orgRole: OrgRole;
}

/** Сервер выбрал организацию — закрепляем выбор для следующих запросов. */
export function writeActiveOrgCookie(orgId: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${ACTIVE_ORG_COOKIE}=${orgId}; path=/; max-age=${ACTIVE_ORG_COOKIE_MAX_AGE}; samesite=lax`;
}

export function readActiveOrgCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${ACTIVE_ORG_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Организация, выбранная до переезда на cookie. Читается ровно один раз —
 * оболочка переносит значение и стирает ключ.
 */
export function takeLegacyActiveOrg(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem(ACTIVE_ORG_LEGACY_KEY);
    if (saved) window.localStorage.removeItem(ACTIVE_ORG_LEGACY_KEY);
    return saved;
  } catch {
    return null;
  }
}

export interface V2State {
  ready: boolean;
  /** Справочники организации ещё грузятся — сайдбар показывает скелет, а не «пусто». */
  metaLoading: boolean;
  error: string | null;
  /** true, когда пользователь авторизован, но ещё не состоит ни в одной организации. */
  needsOnboarding: boolean;
  me: UserBrief | null;
  orgs: OrgSummary[];
  orgId: string | null;
  orgName: string;
  orgRole: OrgRole | null;
  projects: ProjectWithMeta[];
  statuses: TaskStatus[];
  tags: CoreTag[];
  members: OrgMemberWithUser[];
  fields: CustomField[];
  unreadCount: number;
  activeTimer: ActiveTimer | null;

  /** Наполнение из серверного рендера — синхронно, без единого запроса. */
  hydrate: (initial: V2InitialState) => void;
  setFields: (fields: CustomField[]) => void;
  /**
   * Справочник статусов после правки в настройках. Правка отвечает уже новым
   * состоянием, и перечитывать его отдельным запросом незачем; экраны читают
   * статусы прямо из стора, поэтому обновлять надо именно его.
   */
  setStatuses: (statuses: TaskStatus[]) => void;
  /**
   * Проекты после перестановки в панели. По той же причине, что и `setStatuses`:
   * ответ на перестановку — это уже новый список, а панель читает проекты прямо
   * из стора. Он же служит откатом, если перестановка не доехала до сервера.
   */
  setProjects: (projects: ProjectWithMeta[]) => void;
  setActiveTimer: (timer: ActiveTimer | null) => void;
  bootstrap: () => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
  /** Справочники активной организации; вызывается из bootstrap и switchOrg. */
  loadOrgData: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  refreshUnread: () => Promise<void>;
}

const EMPTY = {
  ready: false,
  metaLoading: false,
  error: null,
  needsOnboarding: false,
  me: null,
  orgs: [],
  orgId: null,
  orgName: "",
  orgRole: null,
  projects: [],
  statuses: [],
  tags: [],
  members: [],
  fields: [],
  unreadCount: 0,
  activeTimer: null,
} satisfies Omit<
  V2State,
  | "hydrate"
  | "setFields"
  | "setStatuses"
  | "setProjects"
  | "setActiveTimer"
  | "bootstrap"
  | "switchOrg"
  | "loadOrgData"
  | "refreshProjects"
  | "refreshMeta"
  | "refreshMembers"
  | "refreshUnread"
>;

export function createV2Store(initial?: V2InitialState | null) {
  return createStore<V2State>()((set, get) => ({
    ...EMPTY,
    ...(initial ? { ...initial, ready: true } : {}),

    setActiveTimer: (activeTimer) => set({ activeTimer }),

    hydrate: (next) => {
      // Повторная гидрация приходит при клиентской навигации: серверный рендер
      // следующего экрана приносит свежие справочники, и перетереть ими стор —
      // ровно то, что нужно.
      set({ ...next, ready: true, metaLoading: false, needsOnboarding: false, error: null });
    },

    setFields: (fields) => set({ fields }),

    setStatuses: (statuses) => set({ statuses }),

    setProjects: (projects) => set({ projects }),

    bootstrap: async () => {
      // Фолбэк: серверный рендер уже наполнил стор, сюда попадаем только если
      // оболочка смонтировалась без начальных данных.
      try {
        const me = await api.get<MeResponse>("/me");
        const savedId = readActiveOrgCookie() ?? takeLegacyActiveOrg();
        const org = me.orgs.find((o) => o.id === savedId) ?? me.orgs[0];
        if (!org) {
          set({ me: me.user, orgs: [], needsOnboarding: true, ready: true, error: null });
          return;
        }
        set({
          me: me.user,
          orgs: me.orgs,
          needsOnboarding: false,
          orgId: org.id,
          orgName: org.name,
          orgRole: org.role,
          ready: true,
          metaLoading: true,
          error: null,
        });
        writeActiveOrgCookie(org.id);
        await get().loadOrgData();
      } catch (e) {
        set({ error: e instanceof Error ? e.message : "Не удалось загрузить", ready: true });
      }
    },

    switchOrg: async (orgId: string) => {
      const org = get().orgs.find((o) => o.id === orgId);
      if (!org) return;
      writeActiveOrgCookie(orgId);
      // Кэш запросов ключуется по пути с orgId, но данные экранов соседней
      // организации всё равно чужие — чистим целиком, чтобы старые списки не
      // мелькнули на новом контексте.
      invalidate();
      set({
        orgId: org.id,
        orgName: org.name,
        orgRole: org.role,
        projects: [],
        statuses: [],
        tags: [],
        members: [],
        fields: [],
        unreadCount: 0,
        activeTimer: null,
        metaLoading: true,
        error: null,
      });
      await get().loadOrgData();
    },

    loadOrgData: async () => {
      const { orgId } = get();
      if (!orgId) return;
      try {
        // Один запрос вместо шести: справочники собираются на сервере за один
        // резолв авторизации (см. `loadOrgMeta` в bootstrap.ts).
        const meta = await api.get<OrgMetaResponse>(`/orgs/${orgId}/meta`);
        set({ ...meta, metaLoading: false, error: null });
      } catch (e) {
        set({
          metaLoading: false,
          error: e instanceof Error ? e.message : "Не удалось загрузить",
        });
      }
    },

    refreshProjects: async () => {
      const { orgId } = get();
      if (!orgId) return;
      set({ projects: await api.get<ProjectWithMeta[]>(`/orgs/${orgId}/projects`) });
    },

    refreshMeta: async () => {
      const { orgId } = get();
      if (!orgId) return;
      const [statuses, tags] = await Promise.all([
        api.get<TaskStatus[]>(`/orgs/${orgId}/statuses`),
        api.get<CoreTag[]>(`/orgs/${orgId}/tags`),
      ]);
      set({ statuses, tags });
    },

    refreshMembers: async () => {
      const { orgId } = get();
      if (!orgId) return;
      set({ members: await api.get<OrgMemberWithUser[]>(`/orgs/${orgId}/members`) });
    },

    refreshUnread: async () => {
      const { orgId } = get();
      if (!orgId) return;
      try {
        // count=1 — только счётчик, без выборки самих уведомлений.
        const res = await api.get<{ unread_count: number }>(`/orgs/${orgId}/notifications?count=1`);
        set({ unreadCount: res.unread_count });
      } catch {
        // Периодический опрос: офлайн или мигнувший 500 не должны шуметь в консоль.
      }
    },
  }));
}

export type V2StoreApi = ReturnType<typeof createV2Store>;

const V2StoreContext = createContext<V2StoreApi | null>(null);

/**
 * Создаёт стор на запрос и раздаёт его дереву v2. В браузере инстанс один на
 * всё время жизни вкладки; серверный рендер получает свой на каждый запрос.
 */
export function V2StoreProvider({
  initial,
  children,
}: {
  initial: V2InitialState | null;
  children: React.ReactNode;
}) {
  const ref = useRef<V2StoreApi | null>(null);
  ref.current ??= createV2Store(initial);
  const store = ref.current;

  // Клиентская навигация приносит свежий серверный снимок — вливаем его в
  // существующий стор, а не пересоздаём (иначе слетело бы всё состояние).
  const applied = useRef(initial);
  useEffect(() => {
    if (!initial || applied.current === initial) return;
    applied.current = initial;
    store.getState().hydrate(initial);
  }, [initial, store]);

  return createElement(V2StoreContext.Provider, { value: store }, children);
}

export function useV2StoreApi(): V2StoreApi {
  const store = useContext(V2StoreContext);
  if (!store) throw new Error("useV2Store вне <V2StoreProvider> — стор v2 живёт в /v2/layout.tsx");
  return store;
}

export function useV2Store(): V2State;
export function useV2Store<T>(selector: (state: V2State) => T): T;
export function useV2Store<T>(selector?: (state: V2State) => T) {
  const store = useV2StoreApi();
  return useStore(store, selector ?? ((state) => state as unknown as T));
}
