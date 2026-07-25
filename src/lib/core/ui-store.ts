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

interface V2State {
  ready: boolean;
  error: string | null;
  me: UserBrief | null;
  orgId: string | null;
  orgName: string;
  orgRole: OrgRole | null;
  projects: ProjectWithMeta[];
  statuses: TaskStatus[];
  tags: CoreTag[];
  members: OrgMemberWithUser[];
  unreadCount: number;

  bootstrap: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  refreshUnread: () => Promise<void>;
}

export const useV2Store = create<V2State>((set, get) => ({
  ready: false,
  error: null,
  me: null,
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
      const org = me.orgs[0];
      if (!org) {
        set({ me: me.user, error: "Нет доступных организаций", ready: true });
        return;
      }
      set({ me: me.user, orgId: org.id, orgName: org.name, orgRole: org.role });
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
    const res = await api.get<{ unread_count: number }>(`/orgs/${orgId}/notifications?unread=1`);
    set({ unreadCount: res.unread_count });
  },
}));
