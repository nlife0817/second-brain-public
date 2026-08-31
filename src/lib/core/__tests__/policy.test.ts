import { describe, expect, it } from "vitest";
import {
  canKb,
  canOrg,
  canProject,
  canEditLooseTask,
  canViewLooseTask,
  effectiveKbRole,
  effectiveProjectRole,
  type KbAction,
  type OrgAction,
  type ProjectAction,
} from "../policy";
import type {
  AuthContext,
  OrgRole,
  PolicyKbDocument,
  PolicyProject,
  ProjectRole,
} from "../types";

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
  return { id: "p1", org_id: ORG, default_role: "editor", ...overrides };
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
    ["projects.order",     { owner: true,  admin: true,  member: false, guest: false }],
    ["task.create.personal", { owner: true, admin: true, member: true,  guest: false }],
    ["crm.view",       { owner: true,  admin: true,  member: true,  guest: false }],
    ["crm.manage",     { owner: true,  admin: true,  member: true,  guest: false }],
    ["crm.configure",  { owner: true,  admin: true,  member: false, guest: false }],
    ["kb.create.common", { owner: true, admin: true,  member: true,  guest: false }],
    ["statuses.manage",    { owner: true,  admin: true,  member: false, guest: false }],
    ["fields.manage",      { owner: true,  admin: true,  member: true,  guest: false }],
    ["tags.manage",        { owner: true,  admin: true,  member: true,  guest: false }],
    ["audit.view",         { owner: true,  admin: true,  member: false, guest: false }],
    ["settings.sections.manage", { owner: true, admin: false, member: false, guest: false }],
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
  it("owner и admin — admin в проектах с доступом организации", () => {
    expect(effectiveProjectRole(ctx("owner"), project())).toBe("admin");
    expect(effectiveProjectRole(ctx("admin"), project())).toBe("admin");
    expect(effectiveProjectRole(ctx("owner"), project({ default_role: "viewer" }))).toBe("admin");
  });

  it("закрытый проект недоступен даже owner/admin без явного членства (личный контур)", () => {
    expect(effectiveProjectRole(ctx("owner"), project({ default_role: null }))).toBeNull();
    expect(effectiveProjectRole(ctx("admin"), project({ default_role: null }))).toBeNull();
  });

  it("закрытый проект: явная запись действует для любой org-роли", () => {
    expect(effectiveProjectRole(ctx("owner", { p1: "viewer" }), project({ default_role: null }))).toBe("viewer");
    expect(effectiveProjectRole(ctx("member", { p1: "admin" }), project({ default_role: null }))).toBe("admin");
  });

  it("member получает ровно базовую роль проекта", () => {
    expect(effectiveProjectRole(ctx("member"), project())).toBe("editor");
    expect(effectiveProjectRole(ctx("member"), project({ default_role: "viewer" }))).toBe("viewer");
    expect(effectiveProjectRole(ctx("member"), project({ default_role: "commenter" }))).toBe("commenter");
  });

  it("member: нет доступа в закрытый проект без явной записи", () => {
    expect(effectiveProjectRole(ctx("member"), project({ default_role: null }))).toBeNull();
  });

  it("member: явная запись выигрывает у базовой роли в обе стороны", () => {
    expect(effectiveProjectRole(ctx("member", { p1: "viewer" }), project())).toBe("viewer");
    expect(effectiveProjectRole(ctx("member", { p1: "admin" }), project())).toBe("admin");
    expect(effectiveProjectRole(ctx("member", { p1: "editor" }), project({ default_role: "viewer" }))).toBe("editor");
  });

  it("guest: только явная запись, базовая роль на него не распространяется", () => {
    expect(effectiveProjectRole(ctx("guest"), project())).toBeNull();
    expect(effectiveProjectRole(ctx("guest"), project({ default_role: "viewer" }))).toBeNull();
    expect(effectiveProjectRole(ctx("guest", { p1: "commenter" }), project({ default_role: null }))).toBe("commenter");
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
    // Планирование спринта — работа команды, а не настройка проекта: порог тот
    // же, что у правки задач, иначе команда не может передвинуть свою же задачу.
    ["sprint.manage",           { viewer: false, commenter: false, editor: true,  admin: true }],
    ["doc.create",              { viewer: false, commenter: false, editor: true,  admin: true }],
    ["field.value.edit",        { viewer: false, commenter: false, editor: true,  admin: true }],
    ["project.update",          { viewer: false, commenter: false, editor: false, admin: true }],
    ["project.archive",         { viewer: false, commenter: false, editor: false, admin: true }],
    ["project.delete",          { viewer: false, commenter: false, editor: false, admin: true }],
    ["project.members.manage",  { viewer: false, commenter: false, editor: false, admin: true }],
  ];

  for (const [action, expected] of matrix) {
    for (const role of Object.keys(expected) as ProjectRole[]) {
      it(`${action} для guest с ролью ${role} → ${expected[role]}`, () => {
        expect(canProject(ctx("guest", { p1: role }), action, project({ default_role: null }))).toBe(
          expected[role],
        );
      });
    }
  }

  it("без эффективной роли всё запрещено", () => {
    expect(canProject(ctx("guest"), "project.view", project())).toBe(false);
    expect(canProject(ctx("member"), "project.view", project({ default_role: null }))).toBe(false);
  });

  it("гость не меняет доступ сотрудников даже будучи админом проекта", () => {
    // Иначе гость закрывает проект организации и запирает в нём её сотрудников.
    expect(canProject(ctx("guest", { p1: "admin" }), "project.access", project())).toBe(false);
    expect(canProject(ctx("guest", { p1: "admin" }), "project.update", project())).toBe(true);
  });

  it("базовую роль меняют project admin из числа сотрудников", () => {
    expect(canProject(ctx("member", { p1: "admin" }), "project.access", project())).toBe(true);
    expect(canProject(ctx("owner"), "project.access", project())).toBe(true);
    expect(canProject(ctx("member", { p1: "editor" }), "project.access", project())).toBe(false);
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

// --- База знаний ----------------------------------------------------------------

function doc(overrides: Partial<PolicyKbDocument> = {}): PolicyKbDocument {
  return {
    id: "d1",
    org_id: ORG,
    created_by: "author",
    default_role: null,
    projects: [],
    member_role: null,
    ...overrides,
  };
}

describe("effectiveKbRole: документ в проектах", () => {
  it("роль берётся из проекта, список участников документа не участвует", () => {
    const d = doc({ projects: [project()], member_role: "admin" });
    // member_role игнорируется: иначе запись в документе открывала бы проект.
    expect(effectiveKbRole(ctx("member"), d)).toBe("editor");
  });

  it("из нескольких проектов берётся лучшая роль", () => {
    const d = doc({
      projects: [project({ id: "p1", default_role: "viewer" }), project({ id: "p2", default_role: "editor" })],
    });
    expect(effectiveKbRole(ctx("member"), d)).toBe("editor");
  });

  it("невидимый проект не даёт доступа", () => {
    const d = doc({ projects: [project({ default_role: null })] });
    expect(effectiveKbRole(ctx("member"), d)).toBeNull();
    expect(effectiveKbRole(ctx("owner"), d)).toBeNull();
  });

  it("гость входит по явной роли в проекте", () => {
    const d = doc({ projects: [project({ default_role: null })] });
    expect(effectiveKbRole(ctx("guest", { p1: "commenter" }), d)).toBe("commenter");
  });

  it("автор документа в проекте не получает admin сверх роли проекта", () => {
    const d = doc({ projects: [project({ default_role: "viewer" })], created_by: "u1" });
    expect(effectiveKbRole(ctx("member"), d)).toBe("viewer");
  });
});

describe("effectiveKbRole: общий документ", () => {
  it("автор — всегда admin", () => {
    expect(effectiveKbRole(ctx("member"), doc({ created_by: "u1" }))).toBe("admin");
  });

  it("владелец организации видит и закрытый общий документ — он настраивает доступ", () => {
    expect(effectiveKbRole(ctx("owner"), doc())).toBe("admin");
  });

  it("админ организации в закрытый общий документ не входит", () => {
    expect(effectiveKbRole(ctx("admin"), doc())).toBeNull();
    expect(effectiveKbRole(ctx("member"), doc())).toBeNull();
  });

  it("явная запись действует в закрытом документе", () => {
    expect(effectiveKbRole(ctx("member"), doc({ member_role: "editor" }))).toBe("editor");
    expect(effectiveKbRole(ctx("guest"), doc({ member_role: "viewer" }))).toBe("viewer");
  });

  it("базовая роль раздаётся сотрудникам, админ организации получает admin", () => {
    expect(effectiveKbRole(ctx("member"), doc({ default_role: "viewer" }))).toBe("viewer");
    expect(effectiveKbRole(ctx("admin"), doc({ default_role: "viewer" }))).toBe("admin");
  });

  it("гостю базовая роль не достаётся", () => {
    expect(effectiveKbRole(ctx("guest"), doc({ default_role: "editor" }))).toBeNull();
  });

  it("явная запись выигрывает у базовой роли в обе стороны", () => {
    expect(effectiveKbRole(ctx("member"), doc({ default_role: "editor", member_role: "viewer" }))).toBe("viewer");
    expect(effectiveKbRole(ctx("member"), doc({ default_role: "viewer", member_role: "admin" }))).toBe("admin");
  });

  it("документ чужой организации — всегда null", () => {
    expect(effectiveKbRole(ctx("owner"), doc({ org_id: OTHER_ORG, created_by: "u1" }))).toBeNull();
  });
});

describe("canKb: пороги ролей документа", () => {
  const matrix: Array<[KbAction, Record<ProjectRole, boolean>]> = [
    ["doc.view",    { viewer: true,  commenter: true,  editor: true,  admin: true }],
    ["doc.comment", { viewer: false, commenter: true,  editor: true,  admin: true }],
    ["doc.edit",    { viewer: false, commenter: false, editor: true,  admin: true }],
    ["doc.delete",  { viewer: false, commenter: false, editor: true,  admin: true }],
    ["doc.manage",  { viewer: false, commenter: false, editor: false, admin: true }],
  ];

  for (const [action, expected] of matrix) {
    for (const role of Object.keys(expected) as ProjectRole[]) {
      it(`${action} при роли ${role} → ${expected[role]}`, () => {
        expect(canKb(ctx("member"), action, doc({ member_role: role }))).toBe(expected[role]);
      });
    }
  }

  it("без эффективной роли всё запрещено", () => {
    expect(canKb(ctx("member"), "doc.view", doc())).toBe(false);
  });
});
