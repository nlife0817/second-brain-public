import { describe, expect, it } from "vitest";
import {
  canOrg,
  canProject,
  canEditLooseTask,
  canViewLooseTask,
  effectiveProjectRole,
  type OrgAction,
  type ProjectAction,
} from "../policy";
import type { AuthContext, OrgRole, PolicyProject, ProjectRole } from "../types";

const ORG = "00000000-0000-0000-0000-00000000aaaa";
const OTHER_ORG = "00000000-0000-0000-0000-00000000bbbb";

function ctx(orgRole: OrgRole, projectRoles: Record<string, ProjectRole> = {}): AuthContext {
  return {
    user: {
      id: "u1",
      auth_user_id: null,
      email: "u1@test.dev",
      name: "U1",
      avatar_url: null,
      created_at: "",
      updated_at: "",
    },
    orgId: ORG,
    orgRole,
    projectRoles: new Map(Object.entries(projectRoles)),
  };
}

function project(overrides: Partial<PolicyProject> = {}): PolicyProject {
  return { id: "p1", org_id: ORG, visibility: "org", ...overrides };
}

describe("canOrg: матрица org-ролей", () => {
  const cases: Array<[OrgAction, Record<OrgRole, boolean>]> = [
    ["org.view",           { owner: true,  admin: true,  member: true,  guest: true }],
    ["org.update",         { owner: true,  admin: true,  member: false, guest: false }],
    ["org.members.view",   { owner: true,  admin: true,  member: true,  guest: true }],
    ["org.members.manage", { owner: true,  admin: true,  member: false, guest: false }],
    ["org.invite",         { owner: true,  admin: true,  member: false, guest: false }],
    ["org.delete",         { owner: true,  admin: false, member: false, guest: false }],
    ["project.create",     { owner: true,  admin: true,  member: true,  guest: false }],
    ["clients.view",       { owner: true,  admin: true,  member: true,  guest: false }],
    ["clients.manage",     { owner: true,  admin: true,  member: true,  guest: false }],
    ["statuses.manage",    { owner: true,  admin: true,  member: false, guest: false }],
    ["fields.manage",      { owner: true,  admin: true,  member: true,  guest: false }],
    ["tags.manage",        { owner: true,  admin: true,  member: true,  guest: false }],
    ["audit.view",         { owner: true,  admin: true,  member: false, guest: false }],
  ];

  for (const [action, expected] of cases) {
    for (const role of Object.keys(expected) as OrgRole[]) {
      it(`${action} для ${role} → ${expected[role]}`, () => {
        expect(canOrg(ctx(role), action)).toBe(expected[role]);
      });
    }
  }
});

describe("effectiveProjectRole", () => {
  it("owner и admin — admin в org-видимых проектах", () => {
    expect(effectiveProjectRole(ctx("owner"), project())).toBe("admin");
    expect(effectiveProjectRole(ctx("admin"), project())).toBe("admin");
  });

  it("приватный проект закрыт даже для owner/admin без явного членства (личный контур)", () => {
    expect(effectiveProjectRole(ctx("owner"), project({ visibility: "private" }))).toBeNull();
    expect(effectiveProjectRole(ctx("admin"), project({ visibility: "private" }))).toBeNull();
  });

  it("приватный проект: явная запись действует для любой org-роли", () => {
    expect(effectiveProjectRole(ctx("owner", { p1: "viewer" }), project({ visibility: "private" }))).toBe("viewer");
    expect(effectiveProjectRole(ctx("member", { p1: "admin" }), project({ visibility: "private" }))).toBe("admin");
  });

  it("member: editor по умолчанию в org-видимом проекте", () => {
    expect(effectiveProjectRole(ctx("member"), project())).toBe("editor");
  });

  it("member: нет доступа в приватный проект без явной записи", () => {
    expect(effectiveProjectRole(ctx("member"), project({ visibility: "private" }))).toBeNull();
  });

  it("member: явная запись выигрывает в обе стороны", () => {
    expect(effectiveProjectRole(ctx("member", { p1: "viewer" }), project())).toBe("viewer");
    expect(effectiveProjectRole(ctx("member", { p1: "admin" }), project())).toBe("admin");
  });

  it("guest: только явная запись, org-видимость не помогает", () => {
    expect(effectiveProjectRole(ctx("guest"), project())).toBeNull();
    expect(effectiveProjectRole(ctx("guest", { p1: "commenter" }), project({ visibility: "private" }))).toBe("commenter");
  });

  it("проект чужой организации — всегда null", () => {
    expect(effectiveProjectRole(ctx("owner"), project({ org_id: OTHER_ORG }))).toBeNull();
  });
});

describe("canProject: пороги проектных ролей", () => {
  const matrix: Array<[ProjectAction, Record<ProjectRole, boolean>]> = [
    ["project.view",            { viewer: true,  commenter: true,  editor: true,  admin: true }],
    ["task.comment",            { viewer: false, commenter: true,  editor: true,  admin: true }],
    ["task.create",             { viewer: false, commenter: false, editor: true,  admin: true }],
    ["task.edit",               { viewer: false, commenter: false, editor: true,  admin: true }],
    ["task.delete",             { viewer: false, commenter: false, editor: true,  admin: true }],
    ["section.manage",          { viewer: false, commenter: false, editor: true,  admin: true }],
    ["field.value.edit",        { viewer: false, commenter: false, editor: true,  admin: true }],
    ["project.update",          { viewer: false, commenter: false, editor: false, admin: true }],
    ["project.archive",         { viewer: false, commenter: false, editor: false, admin: true }],
    ["project.members.manage",  { viewer: false, commenter: false, editor: false, admin: true }],
  ];

  for (const [action, expected] of matrix) {
    for (const role of Object.keys(expected) as ProjectRole[]) {
      it(`${action} для guest с ролью ${role} → ${expected[role]}`, () => {
        expect(canProject(ctx("guest", { p1: role }), action, project({ visibility: "private" }))).toBe(
          expected[role],
        );
      });
    }
  }

  it("без эффективной роли всё запрещено", () => {
    expect(canProject(ctx("guest"), "project.view", project())).toBe(false);
    expect(canProject(ctx("member"), "project.view", project({ visibility: "private" }))).toBe(false);
  });
});

describe("задачи вне проектов (личный инбокс)", () => {
  it("видят создатель/исполнитель/подписчик", () => {
    expect(canViewLooseTask({ isCreator: true, isAssignee: false, isFollower: false })).toBe(true);
    expect(canViewLooseTask({ isCreator: false, isAssignee: true, isFollower: false })).toBe(true);
    expect(canViewLooseTask({ isCreator: false, isAssignee: false, isFollower: true })).toBe(true);
    expect(canViewLooseTask({ isCreator: false, isAssignee: false, isFollower: false })).toBe(false);
  });

  it("редактируют создатель и исполнитель, подписчик — нет", () => {
    expect(canEditLooseTask({ isCreator: true, isAssignee: false, isFollower: false })).toBe(true);
    expect(canEditLooseTask({ isCreator: false, isAssignee: true, isFollower: false })).toBe(true);
    expect(canEditLooseTask({ isCreator: false, isAssignee: false, isFollower: true })).toBe(false);
  });
});
