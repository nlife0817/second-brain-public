"use client";

// Zustand-стор интерфейса v2: контекст организации + кэши справочников.

import { create } from "zustand";
import { api } from "./client";
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

const ACTIVE_ORG_KEY = "sb.v2.orgId";

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

  bootstrap: async () => {
    try {
      const me = await api.get<MeResponse>("/me");
      // Активная организация запоминается между визитами.
      const savedId = typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_ORG_KEY) : null;
      const org = me.orgs.find((o) => o.id === savedId) ?? me.orgs[0];
      if (!org) {
        set({ me: me.user, orgs: [], needsOnboarding: true, ready: true, error: null });
        return;
      }
      // ready сразу после /me: оболочка и страница монтируются и грузят своё
      // параллельно со справочниками. Раньше экран висел на «Загрузка…», пока
      // не ответят все шесть запросов, и только потом страница начинала свой.
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
      if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_ORG_KEY, org.id);
      await get().loadOrgData();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Не удалось загрузить", ready: true });
    }
  },

  switchOrg: async (orgId: string) => {
    const org = get().orgs.find((o) => o.id === orgId);
    if (!org) return;
    if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_ORG_KEY, orgId);
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
    // Проекты и справочники статусов критичны — без них нечего показывать;
    // участники, поля и счётчик уведомлений могут не доехать без последствий,
    // и ронять из-за них весь экран не нужно.
    const [projects, meta] = await Promise.all([
      get().refreshProjects().then(() => null).catch((e: unknown) => e),
      get().refreshMeta().then(() => null).catch((e: unknown) => e),
      get().refreshMembers().catch(() => {}),
      get().refreshFields().catch(() => {}),
      get().refreshUnread().catch(() => {}),
    ]);
    const failure = projects ?? meta;
    set({
      metaLoading: false,
      error: failure instanceof Error ? failure.message : failure ? "Не удалось загрузить" : null,
    });
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
