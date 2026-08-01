// Поиск по описанию: проверяем не подсветку, а позиции — из них она и строится.
// Схема здесь своя, минимальная: набор расширений редактора тянет за собой React
// и DOM, а всё, от чего зависит поиск, — это абзацы, текст и нетекстовые листья.

import { describe, expect, it } from "vitest";
import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { findMatches } from "../Search";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    text: { group: "inline" },
    // Лист без текста — как перенос строки или упоминание участника.
    hardBreak: { group: "inline", inline: true, selectable: false, toDOM: () => ["br"] },
  },
});

function paragraph(...content: ("br" | string)[]) {
  return schema.node(
    "paragraph",
    null,
    content.map((part) => (part === "br" ? schema.node("hardBreak") : schema.text(part))),
  );
}

function doc(...paragraphs: ReturnType<typeof paragraph>[]): ProseMirrorNode {
  return schema.node("doc", null, paragraphs);
}

describe("findMatches", () => {
  it("находит все вхождения и указывает на них позициями документа", () => {
    const document = doc(paragraph("мама мыла раму"));
    const matches = findMatches(document, "ма", false);

    expect(matches).toHaveLength(2);
    for (const match of matches) {
      expect(document.textBetween(match.from, match.to)).toBe("ма");
    }
    // Абзац начинается на позиции 0, его текст — на 1.
    expect(matches[0].from).toBe(1);
    expect(matches[1].from).toBe(3);
  });

  it("не склеивает соседние вхождения", () => {
    expect(findMatches(doc(paragraph("ааа")), "аа", false)).toHaveLength(1);
  });

  it("не ищет через границу абзаца", () => {
    const document = doc(paragraph("аб"), paragraph("вг"));
    expect(findMatches(document, "бв", false)).toHaveLength(0);
    expect(findMatches(document, "вг", false)).toHaveLength(1);
  });

  it("по умолчанию не различает регистр, а с флагом — различает", () => {
    const document = doc(paragraph("Раму"));
    expect(findMatches(document, "раму", false)).toHaveLength(1);
    expect(findMatches(document, "раму", true)).toHaveLength(0);
    expect(findMatches(document, "Раму", true)).toHaveLength(1);
  });

  it("не съезжает после нетекстового листа", () => {
    // Лист занимает одну позицию — ровно столько же, сколько заглушка в строке.
    const document = doc(paragraph("аб", "br", "цель"));
    const [match] = findMatches(document, "цель", false);

    expect(match.from).toBe(4);
    expect(document.textBetween(match.from, match.to)).toBe("цель");
  });

  it("на пустом запросе ничего не находит", () => {
    expect(findMatches(doc(paragraph("текст")), "", false)).toHaveLength(0);
  });

  it("находит текст во втором абзаце с учётом его смещения", () => {
    const document = doc(paragraph("первый"), paragraph("второй"));
    const [match] = findMatches(document, "второй", false);

    // Первый абзац занимает 8 позиций: два на сам узел и шесть на текст.
    expect(match.from).toBe(9);
    expect(document.textBetween(match.from, match.to)).toBe("второй");
  });
});
