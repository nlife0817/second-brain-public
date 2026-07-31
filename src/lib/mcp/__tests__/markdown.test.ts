import { describe, expect, it } from "vitest";
import { attachmentIdsFromHtml, htmlToMarkdown, htmlToText } from "../markdown";

const ATTACHMENT = "8f0a7c2e-1b2d-4e5f-9a8b-7c6d5e4f3a2b";
const url = `/api/v2/orgs/22222222-2222-4222-8222-222222222222/attachments/${ATTACHMENT}`;

describe("htmlToMarkdown", () => {
  it("абзацы и заголовки", () => {
    expect(htmlToMarkdown("<h2>Заголовок</h2><p>Текст</p>")).toBe("## Заголовок\n\nТекст");
  });

  it("выделения и ссылки", () => {
    expect(htmlToMarkdown('<p><strong>жирный</strong> и <a href="https://x.dev">ссылка</a></p>')).toBe(
      "**жирный** и [ссылка](https://x.dev)",
    );
  });

  it("списки, включая вложенные", () => {
    const html = "<ul><li>раз<ul><li>вложенный</li></ul></li><li>два</li></ul>";
    expect(htmlToMarkdown(html)).toBe("- раз\n\n  - вложенный\n- два");
  });

  it("нумерованный список считает пункты", () => {
    expect(htmlToMarkdown("<ol><li>первый</li><li>второй</li></ol>")).toBe("1. первый\n2. второй");
  });

  it("таблица превращается в таблицу Markdown", () => {
    const html = "<table><tbody><tr><th>Что</th><th>Кто</th></tr><tr><td>Выкат</td><td>Витя</td></tr></tbody></table>";
    expect(htmlToMarkdown(html)).toBe("| Что | Кто |\n| --- | --- |\n| Выкат | Витя |");
  });

  it("код остаётся кодом", () => {
    expect(htmlToMarkdown("<pre><code>const a = 1;</code></pre>")).toBe("```\nconst a = 1;\n```");
  });

  // Ради этого преобразование и делалось: модель должна суметь запросить файл,
  // а путь к роуту отдачи ей ничего не даёт.
  it("картинка приезжает ссылкой attachment:<id> и несёт подпись", () => {
    const html = `<figure data-image=""><img src="${url}" alt=""><figcaption>Схема</figcaption></figure>`;
    expect(htmlToMarkdown(html)).toBe(`![Схема](attachment:${ATTACHMENT})\n*Схема*`);
  });

  it("вложенный файл — ссылкой с именем", () => {
    const html = `<div data-file="" data-file-name="смета.pdf"><a href="${url}">смета.pdf</a></div>`;
    expect(htmlToMarkdown(html)).toBe(`📎 [смета.pdf](attachment:${ATTACHMENT})`);
  });

  it("упоминание остаётся текстом, метка комментария не видна", () => {
    const html =
      '<p><span data-type="mention" data-id="1" data-label="Аня">@Аня</span>, ' +
      '<span data-comment="c1">посмотри</span></p>';
    expect(htmlToMarkdown(html)).toBe("@Аня, посмотри");
  });

  // Колонки в Markdown не выражаются — но текст из них теряться не должен.
  it("колонки отдают своё содержимое подряд", () => {
    const html = '<div data-columns="2"><div data-column=""><p>Слева</p></div><div data-column=""><p>Справа</p></div></div>';
    expect(htmlToMarkdown(html)).toBe("Слева\n\nСправа");
  });

  it("сущности разворачиваются, спецсимволы экранируются", () => {
    expect(htmlToMarkdown("<p>&laquo;5 &lt; 7&raquo; и *звёздочка*</p>")).toBe("&laquo;5 < 7&raquo; и \\*звёздочка\\*");
  });

  it("пустое описание — пустая строка", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown(null)).toBe("");
    expect(htmlToMarkdown("<p></p>")).toBe("");
  });

  it("незакрытый тег не роняет разбор", () => {
    expect(htmlToMarkdown("<p>Начали<p>Продолжили</p>")).toBe("Начали\n\nПродолжили");
  });
});

describe("htmlToText", () => {
  it("схлопывает документ в строку и режет по пределу", () => {
    expect(htmlToText("<h1>Раз</h1><p>Два</p>")).toBe("Раз Два");
    expect(htmlToText("<p>" + "я".repeat(50) + "</p>", 10)).toBe(`${"я".repeat(9)}…`);
  });

  it("картинки в превью не попадают", () => {
    expect(htmlToText(`<p>До</p><figure data-image=""><img src="${url}"></figure><p>После</p>`)).toBe("До После");
  });
});

describe("attachmentIdsFromHtml", () => {
  it("собирает id вложений без повторов", () => {
    const html = `<img src="${url}"><a href="${url}">файл</a>`;
    expect(attachmentIdsFromHtml(html)).toEqual([ATTACHMENT]);
  });
});
