"use client";

// Zustand-стор интерфейса v2: контекст организации + кэши справочников.
//
// Первичное наполнение приходит из серверного рендера (`hydrate`) — оболочка
// больше не начинает жизнь с семи запросов. Клиентские методы остались для
// обновления после мутаций и для смены организации.

import { create } from "zustand";
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

interface V2State {
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

  /** Наполнение из серверного рендера — синхронно, без единого запроса. */
  hydrate: (initial: V2InitialState) => void;
  bootstrap: () => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
  /** Справочники активной организации; вызывается из bootstrap и switchOrg. */
  loadOrgData: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  refreshFields: () => Promise<void>;
  refreshUnread: () => Promise<void>;
}

export const useV2Store = create<V2State>((set, get) => ({
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

  hydrate: (initial) => {
    // Повторная гидрация приходит при клиентской навигации: серверный рендер
    // следующего экрана приносит свежие справочники, и перетирать ими стор —
    // ровно то, что нужно. Сравнение по ссылке отсекло бы обновление счётчиков.
    set({ ...initial, ready: true, metaLoading: false, needsOnboarding: false, error: null });
  },

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
    // Кэш запросов ключуется по пути с orgId, но данные страниц соседней
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

  // Кастомные поля — справочник организации: держим в сторе, а не тянем
  // заново при каждом открытии карточки задачи.
  refreshFields: async () => {
    const { orgId } = get();
    if (!orgId) return;
    set({ fields: await api.get<CustomField[]>(`/orgs/${orgId}/fields`) });
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
