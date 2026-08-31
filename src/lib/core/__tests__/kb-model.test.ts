import { describe, expect, it } from "vitest";
import {
  buildKbTree,
  collectSubtree,
  isDisposableDocument,
  isMeaningfulRevision,
  normalizeOrder,
  pathToRoot,
  shouldSquashVersion,
  UNTITLED,
  VERSION_SQUASH_MS,
  type KbNodeRow,
} from "../kb-model";
import type { KbNodeKind } from "../types";

function row(
  id: string,
  parent: string | null,
  position: number,
  created = "2026-01-01",
  kind: KbNodeKind = "document",
): KbNodeRow {
  return { id, kind, parent_id: parent, title: id.toUpperCase(), position, created_at: created };
}

describe("buildKbTree", () => {
  it("собирает дерево произвольной глубины", () => {
    const tree = buildKbTree([
      row("a", null, 1),
      row("b", "a", 1),
      row("c", "b", 1),
      row("d", null, 2),
    ]);
    expect(tree.map((n) => n.id)).toEqual(["a", "d"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["b"]);
    expect(tree[0].children[0].children.map((n) => n.id)).toEqual(["c"]);
  });

  it("папки идут перед документами независимо от позиции", () => {
    const tree = buildKbTree([
      row("doc", null, 1),
      row("folder", null, 9, "2026-01-01", "folder"),
    ]);
    expect(tree.map((n) => n.id)).toEqual(["folder", "doc"]);
  });

  it("сортирует соседей по позиции, равные — по времени создания", () => {
    const tree = buildKbTree([
      row("late", null, 1, "2026-02-02"),
      row("early", null, 1, "2026-01-01"),
      row("last", null, 5),
    ]);
    expect(tree.map((n) => n.id)).toEqual(["early", "late", "last"]);
  });

  it("поднимает сироту в корень, а не теряет её", () => {
    // Родителя нет в выборке: он в корзине или невидим.
    const tree = buildKbTree([row("orphan", "gone", 1)]);
    expect(tree.map((n) => n.id)).toEqual(["orphan"]);
    expect(tree[0].parent_id).toBe("gone");
  });

  it("не зацикливается на битых данных", () => {
    // Два узла-родителя друг друга: в корне не окажется ни один, но обход
    // обязан завершиться.
    expect(() => buildKbTree([row("a", "b", 1), row("b", "a", 1)])).not.toThrow();
  });
});

describe("collectSubtree", () => {
  const rows = [row("a", null, 1), row("b", "a", 1), row("c", "b", 1), row("d", null, 2)];

  it("возвращает ветку целиком, включая корень", () => {
    expect(collectSubtree(rows, "a").sort()).toEqual(["a", "b", "c"]);
  });

  it("лист — это он сам", () => {
    expect(collectSubtree(rows, "d")).toEqual(["d"]);
  });

  it("переносить узел внутрь собственной ветки нельзя", () => {
    expect(collectSubtree(rows, "a")).toContain("c");
  });

  it("завершается на цикле в родителях", () => {
    expect(collectSubtree([row("a", "b", 1), row("b", "a", 1)], "a").sort()).toEqual(["a", "b"]);
  });
});

describe("pathToRoot", () => {
  const rows = [
    { id: "a", parent_id: null, title: "Корень", kind: "folder" as const },
    { id: "b", parent_id: "a", title: "Раздел", kind: "folder" as const },
    { id: "c", parent_id: "b", title: "Лист", kind: "document" as const },
  ];

  it("идёт от корня к документу", () => {
    expect(pathToRoot(rows, "c").map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("у корня путь из него одного", () => {
    expect(pathToRoot(rows, "a").map((p) => p.id)).toEqual(["a"]);
  });

  it("завершается на цикле", () => {
    const cyclic = [
      { id: "a", parent_id: "b", title: "A", kind: "folder" as const },
      { id: "b", parent_id: "a", title: "B", kind: "folder" as const },
    ];
    expect(pathToRoot(cyclic, "a")).toHaveLength(2);
  });
});

describe("normalizeOrder", () => {
  it("раздаёт 1..N в присланном порядке", () => {
    expect(normalizeOrder(["x", "y", "z"])).toEqual([
      { id: "x", position: 1 },
      { id: "y", position: 2 },
      { id: "z", position: 3 },
    ]);
  });
});

describe("shouldSquashVersion", () => {
  const now = new Date("2026-08-31T12:00:00.000Z");

  it("первая правка всегда заводит версию", () => {
    expect(shouldSquashVersion(null, "u1", now)).toBe(false);
  });

  it("правка того же автора внутри окна дописывается в последнюю версию", () => {
    const last = { id: "v1", author_id: "u1", updated_at: "2026-08-31T11:55:00.000Z" };
    expect(shouldSquashVersion(last, "u1", now)).toBe(true);
  });

  it("за окном заводится новая версия", () => {
    const last = { id: "v1", author_id: "u1", updated_at: "2026-08-31T11:40:00.000Z" };
    expect(shouldSquashVersion(last, "u1", now)).toBe(false);
  });

  it("чужая правка — всегда новая точка возврата", () => {
    const last = { id: "v1", author_id: "u2", updated_at: "2026-08-31T11:59:00.000Z" };
    expect(shouldSquashVersion(last, "u1", now)).toBe(false);
  });

  it("нечитаемая отметка времени не склеивает", () => {
    const last = { id: "v1", author_id: "u1", updated_at: "не дата" };
    expect(shouldSquashVersion(last, "u1", now)).toBe(false);
  });

  it("граница окна не склеивает", () => {
    const at = new Date(now.getTime() - VERSION_SQUASH_MS).toISOString();
    expect(shouldSquashVersion({ id: "v1", author_id: "u1", updated_at: at }, "u1", now)).toBe(false);
  });
});

describe("isMeaningfulRevision", () => {
  it("правка текста или заголовка — версия", () => {
    expect(isMeaningfulRevision({ title: "A", body: "<p>1</p>" }, { title: "A", body: "<p>2</p>" })).toBe(true);
    expect(isMeaningfulRevision({ title: "A", body: "<p>1</p>" }, { title: "B", body: "<p>1</p>" })).toBe(true);
  });

  it("повторное сохранение того же — не версия", () => {
    expect(isMeaningfulRevision({ title: "A", body: "<p>1</p>" }, { title: "A", body: "<p>1</p>" })).toBe(false);
  });
});

describe("isDisposableDocument", () => {
  const base = { kind: "document" as const, title: UNTITLED, body: "", hasContent: false };

  it("нетронутый документ можно убрать", () => {
    expect(isDisposableDocument(base)).toBe(true);
    expect(isDisposableDocument({ ...base, title: "" })).toBe(true);
    // Пустой редактор отдаёт не пустую строку, а пустой абзац.
    expect(isDisposableDocument({ ...base, body: "<p></p>" })).toBe(true);
    expect(isDisposableDocument({ ...base, body: "<p>&nbsp;</p>" })).toBe(true);
  });

  it("названный документ остаётся, даже пустой", () => {
    expect(isDisposableDocument({ ...base, title: "Регламент" })).toBe(false);
  });

  it("текст или привязки удерживают документ", () => {
    expect(isDisposableDocument({ ...base, body: "<p>а</p>" })).toBe(false);
    expect(isDisposableDocument({ ...base, hasContent: true })).toBe(false);
  });

  it("папку не убираем никогда", () => {
    expect(isDisposableDocument({ ...base, kind: "folder" })).toBe(false);
  });
});
