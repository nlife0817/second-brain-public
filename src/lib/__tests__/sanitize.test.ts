// Санитайзер описания — единственное место, где разметка документа может
// молча исчезнуть. Тег или атрибут, выпавший из allowlist, не даёт ошибки:
// описание просто сохраняется без него, и потеря обнаруживается уже на данных.
// Отсюда тест на каждый блок, который умеет вставлять редактор.

import { describe, expect, it } from "vitest";
import { sanitizeRichText } from "../sanitize";

describe("sanitizeRichText", () => {
  it("оставляет форматирование и заголовки", () => {
    const html =
      "<h1>Раз</h1><h2>Два</h2><p><strong>жирный</strong> <em>курсив</em> <u>подчёркнутый</u> <s>зачёркнутый</s> <mark>выделенный</mark> <code>код</code></p>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("сохраняет таблицу целиком — с шапкой, ширинами колонок и объединением ячеек", () => {
    const clean = sanitizeRichText(
      '<table style="min-width:75px"><colgroup><col style="min-width:25px"></colgroup>' +
        '<tbody><tr><th colspan="2" rowspan="1"><p>Шапка</p></th></tr>' +
        '<tr><td colwidth="120"><p>Ячейка</p></td></tr></tbody></table>',
    );
    expect(clean).toContain("<table");
    expect(clean).toContain("<colgroup>");
    expect(clean).toContain('colspan="2"');
    expect(clean).toContain('colwidth="120"');
    expect(clean).toContain("min-width:25px");
  });

  it("сохраняет раскладку в колонки", () => {
    const clean = sanitizeRichText(
      '<div data-columns="2"><div data-column><p>Слева</p></div><div data-column><p>Справа</p></div></div>',
    );
    expect(clean).toContain('data-columns="2"');
    expect(clean.match(/data-column\b/g)).toHaveLength(2); // две колонки внутри блока
  });

  it("сохраняет картинку с подписью, шириной и выравниванием", () => {
    const clean = sanitizeRichText(
      '<figure data-image data-align="center" style="width:50%">' +
        '<img src="/api/v2/orgs/1/attachments/2" alt="схема"><figcaption>Подпись</figcaption></figure>',
    );
    expect(clean).toContain("<figure");
    expect(clean).toContain('data-align="center"');
    expect(clean).toContain("width:50%");
    expect(clean).toContain("<figcaption>Подпись</figcaption>");
  });

  it("сохраняет якорь комментария вместе с отметкой закрытия", () => {
    const clean = sanitizeRichText(
      '<p><span data-comment="6d9ab062-6145-45e0-ac59-4085083b66d4" data-comment-resolved="true">фрагмент</span></p>',
    );
    expect(clean).toContain('data-comment="6d9ab062-6145-45e0-ac59-4085083b66d4"');
    expect(clean).toContain('data-comment-resolved="true"');
  });

  it("сохраняет вложение-файл", () => {
    const clean = sanitizeRichText(
      '<div data-file data-file-name="договор.pdf" data-file-size="1024">' +
        '<a href="/api/v2/orgs/1/attachments/3">договор.pdf</a></div>',
    );
    expect(clean).toContain('data-file-name="договор.pdf"');
    expect(clean).toContain('href="/api/v2/orgs/1/attachments/3"');
  });

  it("не теряет картинку из унаследованного описания, вставленную как data-URI", () => {
    // В базе есть описание с PNG прямо в разметке. Запрет схемы `data:` стёр бы
    // его при первом же сохранении задачи.
    const clean = sanitizeRichText(
      '<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="снимок"></p>',
    );
    expect(clean).toContain("data:image/png;base64,iVBORw0KGgo=");
  });

  it("вычищает скрипты, обработчики событий и javascript-ссылки", () => {
    const clean = sanitizeRichText(
      '<p onclick="alert(1)">текст</p><script>alert(2)</script>' +
        '<a href="javascript:alert(3)">ссылка</a><iframe src="https://evil"></iframe>',
    );
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("iframe");
  });

  it("пропускает из style только геометрию и выключку", () => {
    const clean = sanitizeRichText(
      '<p style="text-align:center;position:fixed;background-image:url(https://evil)">текст</p>',
    );
    expect(clean).toContain("text-align:center");
    expect(clean).not.toContain("position");
    expect(clean).not.toContain("background-image");
  });

  it("внешняя ссылка уходит с rel, закрывающим доступ к окну-открывателю", () => {
    const clean = sanitizeRichText('<a href="https://example.com" target="_blank">сайт</a>');
    expect(clean).toContain('rel="noopener noreferrer nofollow"');
  });

  // Упоминание проходит без правок allowlist (у span разрешены data-*), но
  // именно поэтому его легко потерять при следующей правке санитайзера.
  it("сохраняет упоминание участника", () => {
    const clean = sanitizeRichText(
      '<p><span data-type="mention" data-id="6d9ab062-6145-45e0-ac59-4085083b66d4" data-label="Иван">@Иван</span> глянь</p>',
    );
    expect(clean).toContain('data-type="mention"');
    expect(clean).toContain('data-id="6d9ab062-6145-45e0-ac59-4085083b66d4"');
    expect(clean).toContain("@Иван");
  });

  it("не строка — пустое описание, а не падение", () => {
    expect(sanitizeRichText(null)).toBe("");
    expect(sanitizeRichText(undefined)).toBe("");
    expect(sanitizeRichText(42)).toBe("");
  });
});
