import { describe, expect, it } from "vitest";
import {
  canSeeSection,
  readSectionsConfig,
  SETTINGS_SECTIONS,
  visibleSections,
  withDefaults,
} from "../settings-sections";

const byId = (id: string) => SETTINGS_SECTIONS.find((s) => s.id === id)!;

describe("readSectionsConfig", () => {
  it("пустая или чужая форма — пустая настройка", () => {
    expect(readSectionsConfig(null)).toEqual({});
    expect(readSectionsConfig({})).toEqual({});
    expect(readSectionsConfig({ settings_sections: "нет" })).toEqual({});
    expect(readSectionsConfig({ settings_sections: ["members"] })).toEqual({});
  });

  it("неизвестные разделы и роли отбрасываются", () => {
    expect(
      readSectionsConfig({
        settings_sections: { members: ["admin", "ceo"], bogus: ["admin"], tags: "admin" },
      }),
    ).toEqual({ members: ["admin"] });
  });
});

describe("withDefaults", () => {
  it("незаданные разделы добираются умолчаниями", () => {
    const full = withDefaults({ tags: [] });
    expect(full.tags).toEqual([]);
    expect(full.members).toEqual(byId("members").defaultRoles);
    expect(Object.keys(full).sort()).toEqual(SETTINGS_SECTIONS.map((s) => s.id).sort());
  });
});

describe("canSeeSection", () => {
  it("владелец видит всё, даже если настройка его не упоминает", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(canSeeSection("owner", section, { [section.id]: [] })).toBe(true);
    }
  });

  it("настройка сужает видимость", () => {
    expect(canSeeSection("member", byId("tags"), {})).toBe(true);
    expect(canSeeSection("member", byId("tags"), { tags: ["admin"] })).toBe(false);
  });

  it("настройка не поднимает роль выше порога policy", () => {
    // Вебхуки отдаёт только администратор — галочка сотруднику ничего не даёт.
    expect(canSeeSection("member", byId("webhooks"), { webhooks: ["admin", "member"] })).toBe(false);
    expect(canSeeSection("guest", byId("audit"), { audit: ["guest"] })).toBe(false);
  });

  it("гость получает раздел, только если ему его открыли", () => {
    expect(canSeeSection("guest", byId("members"), {})).toBe(false);
    expect(canSeeSection("guest", byId("members"), { members: ["guest"] })).toBe(true);
  });
});

describe("visibleSections", () => {
  it("умолчания повторяют прежнее поведение экрана", () => {
    expect(visibleSections("admin", {})).toEqual([
      "members",
      "statuses",
      "tags",
      "fields",
      "audit",
      "export",
      "integrations",
      "webhooks",
    ]);
    // Токен не даёт прав сверх собственных, поэтому «Интеграции» открыты и
    // сотруднику — в отличие от журнала, выгрузки и вебхуков.
    expect(visibleSections("member", {})).toEqual([
      "members",
      "statuses",
      "tags",
      "fields",
      "integrations",
    ]);
    expect(visibleSections("guest", {})).toEqual([]);
  });
});
