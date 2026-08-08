// Разбор упоминаний. Разметку пишет расширение редактора (components/v2/editor/
// Mention.ts), а читает этот модуль — разъедутся, и упоминание молча перестанет
// доходить до человека.

import { describe, expect, it } from "vitest";
import { extractMentionIds, newMentionIds } from "../mentions";

const IVAN = "6d9ab062-6145-45e0-ac59-4085083b66d4";
const ANNA = "0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";

const mention = (id: string, label: string) =>
  `<span data-type="mention" data-id="${id}" data-label="${label}">@${label}</span>`;

describe("extractMentionIds", () => {
  it("находит упоминание в абзаце", () => {
    expect(extractMentionIds(`<p>${mention(IVAN, "Иван")} глянь</p>`)).toEqual([IVAN]);
  });

  it("не путает упоминание с якорем комментария", () => {
    const html = `<p><span data-comment="${ANNA}">кусок</span> и ${mention(IVAN, "Иван")}</p>`;
    expect(extractMentionIds(html)).toEqual([IVAN]);
  });

  it("одного человека дважды не считает", () => {
    expect(extractMentionIds(`<p>${mention(IVAN, "Иван")} ${mention(IVAN, "Иван")}</p>`)).toEqual([IVAN]);
  });

  it("пустой и отсутствующий текст — пустой список", () => {
    expect(extractMentionIds("")).toEqual([]);
    expect(extractMentionIds(null)).toEqual([]);
    expect(extractMentionIds(undefined)).toEqual([]);
  });

  it("data-id не-uuid игнорируется: подставить туда можно что угодно", () => {
    expect(extractMentionIds('<p><span data-type="mention" data-id="admin">@admin</span></p>')).toEqual([]);
  });

  it("чужой атрибут с похожим хвостом имени за упоминание не считается", () => {
    const html = `<p><span data-type="mention" data-comment-id="${ANNA}" data-id="${IVAN}">@Иван</span></p>`;
    expect(extractMentionIds(html)).toEqual([IVAN]);
  });

  it("упоминание без собственного data-id не подхватывает соседний атрибут", () => {
    const html = `<p><span data-type="mention" data-comment-id="${ANNA}">@Кто-то</span></p>`;
    expect(extractMentionIds(html)).toEqual([]);
  });
});

describe("newMentionIds", () => {
  it("уже упомянутых повторно не тревожит", () => {
    const before = `<p>${mention(IVAN, "Иван")}</p>`;
    const after = `<p>${mention(IVAN, "Иван")} и ещё абзац</p>`;
    expect(newMentionIds(after, before)).toEqual([]);
  });

  it("отдаёт только появившихся", () => {
    const before = `<p>${mention(IVAN, "Иван")}</p>`;
    const after = `<p>${mention(IVAN, "Иван")} ${mention(ANNA, "Анна")}</p>`;
    expect(newMentionIds(after, before)).toEqual([ANNA]);
  });

  it("первое сохранение описания уведомляет всех упомянутых", () => {
    expect(newMentionIds(`<p>${mention(ANNA, "Анна")}</p>`, null)).toEqual([ANNA]);
  });
});
