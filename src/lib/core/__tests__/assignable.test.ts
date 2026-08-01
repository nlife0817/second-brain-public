// Интерфейсная половина правила «в закрытый проект чужого исполнителя не
// поставить». Серверная половина — `assertAssigneesInClosedProjects` в tasks.ts;
// расходиться им нельзя, иначе список предлагает то, что сервер отвергнет.

import { describe, expect, it } from "vitest";
import { assignableUserIds, assigneeChoice } from "../assignable";
import type { OrgMemberWithUser, ProjectWithMeta } from "../types";

function project(id: string, name: string, memberIds: string[] | null): ProjectWithMeta {
  return {
    id,
    org_id: "org",
    team_id: null,
    name,
    description: "",
    color: "#6b7280",
    icon: "Folder",
    default_role: memberIds === null ? "editor" : null,
    visibility: memberIds === null ? "org" : "private",
    position: 1,
    archived_at: null,
    created_by: null,
    created_at: "",
    updated_at: "",
    my_role: "admin",
    open_task_count: 0,
    member_ids: memberIds,
  };
}

function member(id: string): OrgMemberWithUser {
  return {
    org_id: "org",
    user_id: id,
    role: "member",
    created_at: "",
    email: `${id}@test.dev`,
    name: id,
    avatar_url: null,
    has_password: true,
  };
}

const MEMBERS = [member("u1"), member("u2"), member("u3")];
const OPEN = project("p-open", "Открытый", null);
const CLOSED = project("p-closed", "Закрытый", ["u1", "u2"]);
const OTHER_CLOSED = project("p-closed-2", "Второй закрытый", ["u2", "u3"]);

describe("assignableUserIds", () => {
  it("без проектов ограничений нет", () => {
    expect(assignableUserIds([], [OPEN, CLOSED])).toBeNull();
  });

  it("открытый проект ничего не ограничивает", () => {
    expect(assignableUserIds(["p-open"], [OPEN, CLOSED])).toBeNull();
  });

  it("закрытый проект пускает только своих", () => {
    expect([...assignableUserIds(["p-closed"], [OPEN, CLOSED])!].sort()).toEqual(["u1", "u2"]);
  });

  it("два закрытых проекта — пересечение составов", () => {
    const allowed = assignableUserIds(["p-closed", "p-closed-2"], [CLOSED, OTHER_CLOSED]);
    expect([...allowed!]).toEqual(["u2"]);
  });

  it("открытый рядом с закрытым ограничение не снимает", () => {
    const allowed = assignableUserIds(["p-open", "p-closed"], [OPEN, CLOSED]);
    expect([...allowed!].sort()).toEqual(["u1", "u2"]);
  });

  it("незнакомый проект не сужает выбор: данных о нём у экрана нет", () => {
    expect(assignableUserIds(["p-unknown"], [OPEN, CLOSED])).toBeNull();
  });
});

describe("assigneeChoice", () => {
  it("оставляет уже назначенного, даже если он выпал из состава проекта", () => {
    const choice = assigneeChoice(MEMBERS, [CLOSED], ["p-closed"], ["u3"]);
    expect(choice.members.map((m) => m.user_id).sort()).toEqual(["u1", "u2", "u3"]);
    expect(choice.restrictedBy).toEqual(["Закрытый"]);
  });

  it("без ограничений отдаёт весь состав организации и молчит о проектах", () => {
    const choice = assigneeChoice(MEMBERS, [OPEN], ["p-open"]);
    expect(choice.members).toHaveLength(3);
    expect(choice.restrictedBy).toEqual([]);
  });

  it("посторонних из закрытого проекта в списке нет", () => {
    const choice = assigneeChoice(MEMBERS, [CLOSED], ["p-closed"]);
    expect(choice.members.map((m) => m.user_id)).toEqual(["u1", "u2"]);
  });
});
