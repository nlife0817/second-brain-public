// Доменные типы ядра v2 (schema core). Не смешивать с типами v1 из @/types.

export type OrgRole = "owner" | "admin" | "member" | "guest";
export type ProjectRole = "admin" | "editor" | "commenter" | "viewer";
export type ProjectVisibility = "org" | "private";

export interface CoreUser {
  id: string;
  auth_user_id: string | null;
  email: string;
  name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

export interface OrgMemberWithUser extends OrgMember {
  email: string;
  name: string;
  avatar_url: string | null;
}

export interface ProjectGrant {
  project_id: string;
  role: ProjectRole;
}

export interface Invitation {
  id: string;
  org_id: string;
  email: string;
  org_role: OrgRole;
  project_grants: ProjectGrant[];
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
}

/** Контекст авторизованного запроса внутри организации. */
export interface AuthContext {
  user: CoreUser;
  orgId: string;
  orgRole: OrgRole;
  /** Явные роли пользователя в проектах этой организации (project_id → role). */
  projectRoles: ReadonlyMap<string, ProjectRole>;
}

/** Мини-срез проекта, достаточный для policy-решений. */
export interface PolicyProject {
  id: string;
  org_id: string;
  visibility: ProjectVisibility;
}

export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  guest: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
  admin: 3,
};
