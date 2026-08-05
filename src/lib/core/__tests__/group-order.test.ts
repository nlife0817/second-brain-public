// Порядок групп в списке задач. Проверяется то, что легко сломать обратной
// правкой: расставленные руками идут первыми, неупомянутые — после них (а не
// вперемешку), «пусто» остаётся последним даже если его затащили в ручной
// порядок, а равные ранги разводит подпись, а не порядок ключей в наборе.

import { describe, expect, it } from "vitest";
import { NONE_VALUE, orderGroupKeys } from "../views";

/** Ранг «по справочнику»: чем меньше номер, тем выше группа. */
const RANK: Record<string, number> = { backlog: 1, work: 2, review: 3, done: 4 };

function order(keys: string[], manual?: string[]): string[] {
  return orderGroupKeys(keys, {
    manual,
    rank: (key) => RANK[key] ?? 9998,
    label: (key) => key,
  });
}

describe("orderGroupKeys", () => {
  it("без ручного порядка идёт по справочнику", () => {
    expect(order(["done", "backlog", "review", "work"])).toEqual(["backlog", "work", "review", "done"]);
  });

  it("ручной порядок выигрывает у справочника", () => {
    expect(order(["backlog", "work", "done"], ["done", "work", "backlog"])).toEqual([
      "done",
      "work",
      "backlog",
    ]);
  });

  it("неупомянутые идут после расставленных, между собой — по справочнику", () => {
    expect(order(["backlog", "work", "review", "done"], ["done"])).toEqual([
      "done",
      "backlog",
      "work",
      "review",
    ]);
  });

  it("«пусто» остаётся последним", () => {
    expect(order([NONE_VALUE, "work", "backlog"])).toEqual(["backlog", "work", NONE_VALUE]);
  });

  it("«пусто» не поднимается даже из ручного порядка", () => {
    expect(order([NONE_VALUE, "work", "backlog"], [NONE_VALUE, "work"])).toEqual([
      "work",
      "backlog",
      NONE_VALUE,
    ]);
  });

  it("неизвестные ключи выстраиваются по подписи, а не по порядку прихода", () => {
    expect(order(["яблоко", "арбуз"])).toEqual(["арбуз", "яблоко"]);
    expect(order(["арбуз", "яблоко"])).toEqual(["арбуз", "яблоко"]);
  });

  it("исходный набор не мутируется", () => {
    const keys = ["done", "backlog"];
    order(keys);
    expect(keys).toEqual(["done", "backlog"]);
  });
});
