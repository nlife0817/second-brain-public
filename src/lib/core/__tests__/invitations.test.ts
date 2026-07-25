// Приём приглашения по ссылке. В проде POST /api/v2/invitations/[token] отвечал
// 500 с UNDEFINED_VALUE от postgres.js: в параметры запроса уходил undefined.
// Единственное значение в этой транзакции, форму которого не гарантирует схема, —
// jsonb-колонка project_grants; из неё project_id/role шли в prepare() как есть.
//
// Драйвер здесь подменён, но правило драйвера воспроизведено буквально:
// undefined в параметрах — исключение. Поэтому утечка любого undefined валит тест.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { query: string; params: unknown[] };

const db = vi.hoisted(() => {
  const calls: Call[] = [];
  /** Ответы по фрагменту запроса; первый совпавший ключ и отвечает. */
  let rows: Array<[string, unknown[]]> = [];

  function collapse(query: string): string {
    return query.replace(/\s+/g, " ").trim();
  }

  function statement(query: string) {
    const text = collapse(query);
    const exec = (params: unknown[]): unknown[] => {
      const i = params.indexOf(undefined);
      if (i !== -1) {
        // Ровно то, что бросает postgres.js (src/types.js, handleValue).
        const err = new Error("UNDEFINED_VALUE: Undefined values are not allowed");
        (err as Error & { code?: string }).code = "UNDEFINED_VALUE";
        throw err;
      }
      calls.push({ query: text, params });
      return rows.find(([fragment]) => text.includes(fragment))?.[1] ?? [];
    };
    return {
      get: async (...params: unknown[]) => exec(params)[0],
      all: async (...params: unknown[]) => exec(params),
      run: async (...params: unknown[]) => ({ changes: exec(params).length }),
    };
  }

  return {
    calls,
    reset: (answers: Array<[string, unknown[]]>) => {
      calls.length = 0;
      rows = answers;
    },
    /** Запросы, в которых встретился фрагмент. */
    matching: (fragment: string) => calls.filter((c) => c.query.includes(fragment)),
    prepare: (query: string) => statement(query),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn({ prepare: (query: string) => statement(query), exec: async () => {} }),
  };
});

vi.mock("@/lib/sql", () => ({ prepare: db.prepare, transaction: db.transaction }));

const { acceptInvitation, normalizeProjectGrants } = await import("../identity");

const USER = { id: "3f1c3e1e-0000-4000-8000-000000000001", email: "Ivan@Example.COM" };
const ORG = "625014ea-1fe0-48a1-be07-71abd081d68a";
const PROJECT = "9a0b6a4c-0000-4000-8000-0000000000aa";

/** Ответы БД для успешного приёма приглашения с заданными project_grants. */
function answers(projectGrants: unknown): Array<[string, unknown[]]> {
  return [
    [
      "UPDATE core.invitations",
      [
        {
          id: "059fda45-cc5c-4a27-bb69-05d50448858e",
          org_id: ORG,
          email: "ivan@example.com",
          org_role: "member",
          project_grants: projectGrants,
        },
      ],
    ],
    ["SELECT id FROM core.projects", [{ id: PROJECT }]],
    ["SELECT name FROM core.organizations", [{ name: "Второй мозг" }]],
  ];
}

describe("normalizeProjectGrants", () => {
  it("оставляет корректные записи", () => {
    expect(normalizeProjectGrants([{ project_id: PROJECT, role: "editor" }])).toEqual([
      { project_id: PROJECT, role: "editor" },
    ]);
  });

  it("отбрасывает записи без project_id или с чужой ролью", () => {
    expect(
      normalizeProjectGrants([
        {},
        { role: "editor" },
        { project_id: null, role: "editor" },
        { project_id: "", role: "editor" },
        { project_id: PROJECT },
        { project_id: PROJECT, role: null },
        { project_id: PROJECT, role: "owner" },
        { project_id: PROJECT, role: "editor" },
        "не объект",
        null,
      ]),
    ).toEqual([{ project_id: PROJECT, role: "editor" }]);
  });

  it("не принимает за список то, что списком не является", () => {
    // jsonb может вернуться строкой — for..of прошёлся бы по символам,
    // и в запрос улетел бы undefined вместо project_id.
    expect(normalizeProjectGrants("[]")).toEqual([]);
    expect(normalizeProjectGrants('[{"project_id":"x","role":"editor"}]')).toEqual([]);
    expect(normalizeProjectGrants(null)).toEqual([]);
    expect(normalizeProjectGrants(undefined)).toEqual([]);
    expect(normalizeProjectGrants({ project_id: PROJECT, role: "editor" })).toEqual([]);
  });
});

describe("acceptInvitation", () => {
  beforeEach(() => db.reset(answers([])));

  it("заводит членство в организации и возвращает её", async () => {
    const result = await acceptInvitation("raw-token", USER);

    expect(result).toEqual({ org_id: ORG, org_name: "Второй мозг", role: "member" });
    expect(db.matching("INSERT INTO core.org_members")[0].params).toEqual([
      ORG,
      USER.id,
      "member",
    ]);
  });

  it("гасит токен по его хэшу и приводит email сессии к нижнему регистру", async () => {
    await acceptInvitation("raw-token", USER);

    const [accepted_by, tokenHash, email] = db.matching("UPDATE core.invitations")[0].params;
    expect(accepted_by).toBe(USER.id);
    expect(email).toBe("ivan@example.com");
    // sha256("raw-token") — сырой токен в БД не хранится.
    expect(tokenHash).toBe("34d328009b123fbbb0dc93f18b3e6de1ecf7b1a5783c33dff7ffe1926f09e943");
  });

  it("выдаёт доступ к проекту из приглашения", async () => {
    db.reset(answers([{ project_id: PROJECT, role: "editor" }]));

    await acceptInvitation("raw-token", USER);

    expect(db.matching("INSERT INTO core.project_members")[0].params).toEqual([
      PROJECT,
      USER.id,
      "editor",
    ]);
  });

  it("не трогает проект, которого больше нет в этой организации", async () => {
    db.reset([
      ...answers([{ project_id: PROJECT, role: "editor" }]).filter(
        ([fragment]) => fragment !== "SELECT id FROM core.projects",
      ),
      ["SELECT id FROM core.projects", []],
    ]);

    await acceptInvitation("raw-token", USER);

    expect(db.matching("INSERT INTO core.project_members")).toHaveLength(0);
  });

  it.each([
    ["запись без project_id", [{ role: "editor" }]],
    ["project_id === null", [{ project_id: null, role: "editor" }]],
    ["запись без роли", [{ project_id: PROJECT }]],
    ["пустой объект", [{}]],
    ["jsonb пришёл строкой", "[]"],
    ["jsonb пришёл объектом", { project_id: PROJECT, role: "editor" }],
  ])("не роняет приём приглашения: %s", async (_case, grants) => {
    db.reset(answers(grants));

    // Регресс: раньше отсюда прилетал UNDEFINED_VALUE и весь приём падал с 500.
    await expect(acceptInvitation("raw-token", USER)).resolves.toEqual({
      org_id: ORG,
      org_name: "Второй мозг",
      role: "member",
    });
    expect(db.matching("INSERT INTO core.org_members")).toHaveLength(1);
    expect(db.matching("INSERT INTO core.project_members")).toHaveLength(0);
  });

  it("отвечает 404 на чужой, истёкший или уже принятый токен", async () => {
    db.reset([["UPDATE core.invitations", []]]);

    await expect(acceptInvitation("raw-token", USER)).rejects.toMatchObject({ status: 404 });
    expect(db.matching("INSERT INTO core.org_members")).toHaveLength(0);
  });

  it("не пытается писать членство, если в строке приглашения нет организации", async () => {
    db.reset([["UPDATE core.invitations", [{ id: "x", email: "ivan@example.com" }]]]);

    await expect(acceptInvitation("raw-token", USER)).rejects.toMatchObject({ status: 500 });
    expect(db.matching("INSERT INTO core.org_members")).toHaveLength(0);
  });
});
