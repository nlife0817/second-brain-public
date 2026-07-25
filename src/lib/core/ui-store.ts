"use client";

// Zustand-стор интерфейса v2: контекст организации + кэши справочников.

import { create } from "zustand";
import { api } from "./client";
import type {
  CoreTag,
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
  unreadCount: number;

  bootstrap: () => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  refreshUnread: () => Promise<void>;
}

export const useV2Store = create<V2State>((set, get) => ({
  ready: false,
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
      set({
        me: me.user,
        orgs: me.orgs,
        needsOnboarding: false,
        orgId: org.id,
        orgName: org.name,
        orgRole: org.role,
      });
      if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_ORG_KEY, org.id);
      await Promise.all([
        get().refreshProjects(),
        get().refreshMeta(),
        get().refreshMembers(),
        get().refreshUnread(),
      ]);
      set({ ready: true, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Не удалось загрузить", ready: true });
    }
  },

  switchOrg: async (orgId: string) => {
    const org = get().orgs.find((o) => o.id === orgId);
    if (!org) return;
    if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_ORG_KEY, orgId);
    set({ ready: false, orgId: org.id, orgName: org.name, orgRole: org.role, projects: [] });
    await Promise.all([
      get().refreshProjects(),
      get().refreshMeta(),
      get().refreshMembers(),
      get().refreshUnread(),
    ]);
    set({ ready: true });
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
      const res = await api.get<{ unread_count: number }>(`/orgs/${orgId}/notifications?unread=1`);
      set({ unreadCount: res.unread_count });
    } catch {
      // Периодический опрос: офлайн или мигнувший 500 не должны шуметь в консоль.
    }
  },
}));
