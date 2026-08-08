// Вложенность подзадач считается по ВСЕМУ набору и до группировки. Раньше
// раскладка шла внутри уже готовой корзины: подзадача со статусом, отличным от
// родительского, попадала в чужую группу, не находила там родителя и рисовалась
// отдельной строкой — при включённом режиме «вложенными под родителя». А так как
// группировка по статусу включена по умолчанию, режим почти всегда не работал.

import { describe, expect, it } from "vitest";
import { arrangeGroupRows, arrangeRows, buildForest, expandRoots } from "../views";
import type { TaskRow } from "../types";

function task(id: string, parent: string | null = null, statusId = "s-doing"): TaskRow {
  return { id, parent_task_id: parent, status_id: statusId } as TaskRow;
}

/** Компактная запись результата: «id:глубина». */
const shape = (rows: Array<{ task: TaskRow; depth: number }>) =>
  rows.map((r) => `${r.task.id}:${r.depth}`);

describe("buildForest", () => {
  it("корнями считает задачи без родителя в наборе", () => {
    const rows = [task("a"), task("b", "a"), task("c")];
    const forest = buildForest(rows);
    expect(forest.roots.map((t) => t.id)).toEqual(["a", "c"]);
    expect(forest.childrenOf.get("a")?.map((t) => t.id)).toEqual(["b"]);
  });

  it("осиротевшую подзадачу поднимает в корни: её родителя нет в наборе", () => {
    const forest = buildForest([task("b", "missing-parent")]);
    expect(forest.roots.map((t) => t.id)).toEqual(["b"]);
  });

  it("не теряет задачи при взаимной ссылке в данных", () => {
    // Сервер такое запрещает (isSelfOrDescendant), но по формальному признаку
    // «есть родитель в наборе» корнем здесь не становится ни одна из задач.
    // Цикл размыкается: первая уходит в корни, вторая рисуется под ней —
    // важно, что каждая задача попадает в список ровно один раз.
    const rows = [task("a", "b"), task("b", "a")];
    const forest = buildForest(rows);
    expect(shape(expandRoots(forest.roots, forest))).toEqual(["a:0", "b:1"]);
  });

  it("глубже восьми уровней не проваливается", () => {
    const chain = Array.from({ length: 30 }, (_, i) =>
      task(`t${i}`, i === 0 ? null : `t${i - 1}`),
    );
    const forest = buildForest(chain);
    const rows = expandRoots(forest.roots, forest);
    // Ни одна задача не потеряна, и глубина ограничена защитой от зацикливания.
    expect(rows).toHaveLength(chain.length);
    expect(Math.max(...rows.map((r) => r.depth))).toBeLessThanOrEqual(8);
  });
});

describe("expandRoots", () => {
  it("разворачивает поддерево с нарастающей глубиной", () => {
    const rows = [task("a"), task("b", "a"), task("c", "b")];
    const forest = buildForest(rows);
    expect(shape(expandRoots(forest.roots, forest))).toEqual(["a:0", "b:1", "c:2"]);
  });

  it("каждую задачу выдаёт один раз", () => {
    const rows = [task("a"), task("b", "a"), task("c", "a")];
    const forest = buildForest(rows);
    expect(shape(expandRoots(forest.roots, forest))).toEqual(["a:0", "b:1", "c:1"]);
  });
});

describe("arrangeGroupRows — подзадача в группе родителя", () => {
  // Родитель «в работе», подзадача «готово»: при группировке по статусу они
  // раньше оказывались в разных корзинах, и вложенность разваливалась.
  const all = [task("parent", null, "s-doing"), task("child", "parent", "s-done")];
  const forest = buildForest(all);

  it("рисует подзадачу под родителем, хотя её статус относится к другой группе", () => {
    // В корзину «в работе» попадает только корень — так теперь работает buildGroups.
    const group = forest.roots.filter((t) => t.status_id === "s-doing");
    expect(shape(arrangeGroupRows(group, forest, "nested"))).toEqual(["parent:0", "child:1"]);
  });

  it("в группе «готово» подзадачи уже нет — она уехала к родителю", () => {
    const group = forest.roots.filter((t) => t.status_id === "s-done");
    expect(group).toHaveLength(0);
  });

  it("в режиме «скрыть» показывает только корни группы", () => {
    const group = forest.roots.filter((t) => t.status_id === "s-doing");
    expect(shape(arrangeGroupRows(group, forest, "hidden"))).toEqual(["parent:0"]);
  });

  it("без леса (режим «отдельными строками») раскладывает плоско", () => {
    expect(shape(arrangeGroupRows(all, null, "flat"))).toEqual(["parent:0", "child:0"]);
  });
});

describe("свёрнутые поддеревья", () => {
  it("свёрнутый родитель прячет всё поддерево, а не только первый уровень", () => {
    const rows = [task("a"), task("b", "a"), task("c", "b"), task("d")];
    const forest = buildForest(rows);
    expect(shape(expandRoots(forest.roots, forest, new Set(["a"])))).toEqual(["a:0", "d:0"]);
  });

  it("свёрнутая ветка внутри развёрнутой не задевает соседей", () => {
    const rows = [task("a"), task("b", "a"), task("c", "b"), task("e", "a")];
    const forest = buildForest(rows);
    expect(shape(expandRoots(forest.roots, forest, new Set(["b"])))).toEqual(["a:0", "b:1", "e:1"]);
  });

  it("шеврон помечает только строки с подзадачами в срезе", () => {
    const rows = [task("a"), task("b", "a"), task("c")];
    const forest = buildForest(rows);
    expect(expandRoots(forest.roots, forest).map((r) => [r.task.id, r.hasChildren])).toEqual([
      ["a", true],
      ["b", false],
      ["c", false],
    ]);
  });

  it("id в наборе без детей в срезе не делает строку свёрнутой", () => {
    // Родителя свернули, потом отфильтровали его подзадачи: строка обязана
    // выглядеть обычным листом, иначе шеврон обещает то, чего нет.
    const forest = buildForest([task("a")]);
    const [row] = expandRoots(forest.roots, forest, new Set(["a"]));
    expect([row.hasChildren, row.collapsed]).toEqual([false, false]);
  });

  it("в режимах «отдельными строками» и «скрыть» сворачивать нечего", () => {
    const all = [task("a"), task("b", "a")];
    const forest = buildForest(all);
    // Свёрнутость передана, но строк она не убирает и шеврона не даёт.
    expect(shape(arrangeGroupRows(all, null, "flat", new Set(["a"])))).toEqual(["a:0", "b:0"]);
    const hidden = arrangeGroupRows(forest.roots, forest, "hidden", new Set(["a"]));
    expect(hidden.map((r) => [r.task.id, r.hasChildren, r.collapsed])).toEqual([["a", false, false]]);
  });
});

describe("arrangeRows — список без группировки", () => {
  const rows = [task("a"), task("b", "a"), task("c")];

  it("flat: всё на нулевой глубине, порядок сортировки сохранён", () => {
    expect(shape(arrangeRows(rows, "flat"))).toEqual(["a:0", "b:0", "c:0"]);
  });

  it("nested: дети идут сразу за родителем", () => {
    expect(shape(arrangeRows(rows, "nested"))).toEqual(["a:0", "b:1", "c:0"]);
  });

  it("hidden: подзадачи убраны", () => {
    expect(shape(arrangeRows(rows, "hidden"))).toEqual(["a:0", "c:0"]);
  });
});
