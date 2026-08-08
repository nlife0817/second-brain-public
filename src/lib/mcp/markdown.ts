// Описание задачи и тела комментариев → Markdown для модели.
//
// Читать документ тегами дорого и неудобно, поэтому наружу он уходит
// Markdown'ом. Обратного преобразования здесь нет намеренно: пишет модель
// по-прежнему HTML (см. src/lib/mcp/tools.ts). Markdown в обе стороны схлопнул
// бы документ — колонки, подписи к картинкам и якоря обсуждений не имеют в нём
// представления, и первая же правка описания стёрла бы их.
//
// Разбор — свой, без зависимости: на входе всегда наша собственная разметка,
// прошедшая `sanitizeRichText`, то есть закрытый список тегов из
// lib/sanitize.ts. Универсальный парсер здесь решал бы задачу, которой нет.
//
// Вложения приезжают ссылкой `attachment:<uuid>`, а не путём к роуту: путь
// модель всё равно не откроет — за файлом она приходит инструментом
// `get_attachment`, и ему нужен именно id.

/** Теги без закрывающей пары. */
const VOID_TAGS = new Set(["br", "hr", "img", "col"]);

interface ElementNode {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
}

interface TextNode {
  type: "text";
  value: string;
}

type Node = ElementNode | TextNode;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** Блоки, внутри которых не может стоять другой блок: открытие такого закрывает предыдущий. */
const CLOSED_BY_BLOCK = new Set(["p", "li"]);
const BLOCK_TAGS = new Set([
  "p", "div", "ul", "ol", "li", "blockquote", "pre", "figure", "table", "tr", "td", "th",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr",
]);

/**
 * Разметка → дерево. Незакрытый тег закрывается концом родителя, лишний
 * закрывающий игнорируется, а `<p>` без пары — открытием следующего блока: так
 * же поступает браузер, и без этого два абзаца слипались бы в один.
 */
function parseHtml(html: string): Node[] {
  const root: ElementNode = { type: "element", tag: "#root", attrs: {}, children: [] };
  const stack: ElementNode[] = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html))) {
    const [full, closing, tagName, rawAttrs, text] = m;
    if (text !== undefined) {
      const value = decodeEntities(text);
      if (value) stack[stack.length - 1].children.push({ type: "text", value });
      continue;
    }
    if (!tagName) continue; // комментарий разметки
    const tag = tagName.toLowerCase();
    if (closing) {
      // Закрываем ближайший одноимённый; чужие закрывающие теги пропускаем.
      const index = stack.findLastIndex((el) => el.tag === tag);
      if (index > 0) stack.length = index;
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      while (stack.length > 1 && CLOSED_BY_BLOCK.has(stack[stack.length - 1].tag)) {
        // Вложенный список — законный ребёнок `li`, закрывать его нельзя.
        if (stack[stack.length - 1].tag === "li" && (tag === "ul" || tag === "ol")) break;
        stack.pop();
      }
    }
    const node: ElementNode = { type: "element", tag, attrs: parseAttrs(rawAttrs ?? ""), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!VOID_TAGS.has(tag) && !full.endsWith("/>")) stack.push(node);
  }
  return root.children;
}

/** id вложения из пути отдачи файла (`/api/v2/orgs/<org>/attachments/<id>`). */
function attachmentRef(url: string): string | null {
  const m = url.match(/\/attachments\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

function linkTarget(url: string): string {
  const id = attachmentRef(url);
  return id ? `attachment:${id}` : url;
}

/** Экранируем только то, что иначе прочтётся как разметка. */
function escapeText(value: string): string {
  return value.replace(/([\\`*_[\]])/g, "\\$1");
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ");
}

interface RenderState {
  /** Внутри `pre` пробелы и переносы значимы, экранировать ничего нельзя. */
  raw?: boolean;
}

function renderInline(nodes: Node[], state: RenderState = {}): string {
  return nodes.map((node) => renderInlineNode(node, state)).join("");
}

function renderInlineNode(node: Node, state: RenderState): string {
  if (node.type === "text") return state.raw ? node.value : escapeText(collapse(node.value));
  const inner = renderInline(node.children, state);
  switch (node.tag) {
    case "br":
      return "\n";
    case "strong":
    case "b":
      return inner.trim() ? `**${inner}**` : "";
    case "em":
    case "i":
      return inner.trim() ? `*${inner}*` : "";
    case "s":
      return inner.trim() ? `~~${inner}~~` : "";
    case "code":
      return inner.trim() ? `\`${inner.replace(/\\([\\`*_[\]])/g, "$1")}\`` : "";
    case "a": {
      const href = node.attrs.href ?? "";
      if (!inner.trim()) return "";
      return href ? `[${inner}](${linkTarget(href)})` : inner;
    }
    case "img": {
      const alt = node.attrs.alt ?? "";
      return `![${alt}](${linkTarget(node.attrs.src ?? "")})`;
    }
    case "span":
      // Упоминание уже несёт «@…» текстом, метка комментария — просто обёртка
      // вокруг фрагмента: обе отдаём содержимым.
      return inner;
    default:
      return inner;
  }
}

function renderChildren(nodes: Node[], depth: number): string[] {
  const blocks: string[] = [];
  let inlineBuffer: Node[] = [];

  const flush = () => {
    if (inlineBuffer.length === 0) return;
    const text = renderInline(inlineBuffer).trim();
    inlineBuffer = [];
    if (text) blocks.push(text);
  };

  for (const node of nodes) {
    if (node.type === "text") {
      if (node.value.trim()) inlineBuffer.push(node);
      continue;
    }
    const block = renderBlock(node, depth);
    if (block === null) {
      inlineBuffer.push(node);
      continue;
    }
    flush();
    if (block.trim()) blocks.push(block);
  }
  flush();
  return blocks;
}

/** Блочный узел → Markdown; null означает «это инлайн, собери его в абзац». */
function renderBlock(node: ElementNode, depth: number): string | null {
  switch (node.tag) {
    case "p":
      return renderInline(node.children).trim();
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(node.tag[1]);
      return `${"#".repeat(level)} ${renderInline(node.children).trim()}`;
    }
    case "hr":
      return "---";
    case "ul":
    case "ol":
      return renderList(node, depth);
    case "blockquote":
      return renderChildren(node.children, depth)
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`.trimEnd())
        .join("\n");
    case "pre": {
      // Внутри блока кода разметка не действует: `<code>` здесь обёртка, а не
      // инлайновый код, и его обратные кавычки оказались бы в тексте программы.
      const code = plainText(node.children).replace(/\n$/, "");
      const language = (node.attrs.class ?? "").match(/language-([\w+-]+)/)?.[1] ?? "";
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }
    case "figure":
      return renderFigure(node);
    case "table":
      return renderTable(node);
    case "div":
      if ("data-file" in node.attrs) return renderFile(node);
      // Колонки и прочие обёртки: содержимое идёт подряд. Раскладка в Markdown
      // не выражается, а текст терять нельзя.
      return renderChildren(node.children, depth).join("\n\n");
    default:
      return null;
  }
}

function renderFigure(node: ElementNode): string {
  const img = findFirst(node, "img");
  const caption = findFirst(node, "figcaption");
  const captionText = caption ? renderInline(caption.children).trim() : "";
  if (!img) return captionText;
  const alt = captionText || img.attrs.alt || "";
  const image = `![${alt}](${linkTarget(img.attrs.src ?? "")})`;
  return captionText ? `${image}\n*${captionText}*` : image;
}

function renderFile(node: ElementNode): string {
  const link = findFirst(node, "a");
  const name = node.attrs["data-file-name"] || (link ? renderInline(link.children).trim() : "файл");
  const href = link?.attrs.href ?? "";
  return `📎 [${name}](${linkTarget(href)})`;
}

/**
 * Отступ вложенного списка даёт не сам список, а продолжение строки пункта, в
 * который он вложен: считать его ещё и по глубине — значит сдвинуть дважды.
 */
function renderList(node: ElementNode, depth: number): string {
  const ordered = node.tag === "ol";
  const items: string[] = [];
  let index = Number(node.attrs.start ?? 1) || 1;

  for (const child of node.children) {
    if (child.type !== "element" || child.tag !== "li") continue;
    const marker = ordered ? `${index++}. ` : "- ";
    const body = renderChildren(child.children, depth + 1).join("\n\n");
    const [first = "", ...rest] = body.split("\n");
    const pad = " ".repeat(marker.length);
    items.push([`${marker}${first}`, ...rest.map((line) => (line ? `${pad}${line}` : ""))].join("\n"));
  }
  return items.join("\n");
}

function renderTable(node: ElementNode): string {
  const rows = collectAll(node, "tr");
  if (rows.length === 0) return "";
  const cells = rows.map((row) =>
    row.children
      .filter((c): c is ElementNode => c.type === "element" && (c.tag === "td" || c.tag === "th"))
      // Перенос внутри ячейки сломал бы таблицу: строка в Markdown одна.
      .map((c) => renderInline(c.children).replace(/\n+/g, " ").trim()),
  );
  const width = Math.max(...cells.map((r) => r.length));
  const pad = (row: string[]) => [...row, ...Array(width - row.length).fill("")];
  const [header, ...body] = cells;
  return [
    `| ${pad(header).join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...body.map((row) => `| ${pad(row).join(" | ")} |`),
  ].join("\n");
}

function findFirst(node: ElementNode, tag: string): ElementNode | null {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tag === tag) return child;
    const nested = findFirst(child, tag);
    if (nested) return nested;
  }
  return null;
}

function collectAll(node: ElementNode, tag: string): ElementNode[] {
  const out: ElementNode[] = [];
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tag === tag) out.push(child);
    else out.push(...collectAll(child, tag));
  }
  return out;
}

/** Только текст, без разметки: нужен блокам кода и коротким превью. */
function plainText(nodes: Node[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.value;
      if (node.tag === "img") return "";
      if (node.tag === "br") return "\n";
      return plainText(node.children);
    })
    .join("");
}

/** HTML документа → Markdown. Пустое описание даёт пустую строку. */
export function htmlToMarkdown(html: string | null | undefined): string {
  if (!html) return "";
  const blocks = renderChildren(parseHtml(html), 0);
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Плоский текст той же разметки — для коротких превью.
 *
 * Считается по дереву, а не чисткой готового Markdown: убирать из него решётки
 * заголовков, дефисы списков и палки таблиц значило бы писать второй парсер,
 * который вдобавок не отличает разметку от такого же символа в тексте.
 */
export function htmlToText(html: string | null | undefined, limit = 200): string {
  if (!html) return "";
  const walk = (nodes: Node[]): string =>
    nodes
      .map((node) => {
        if (node.type === "text") return node.value;
        if (node.tag === "img") return "";
        const inner = walk(node.children);
        // Соседние блоки не слипаются: «Раз» и «Два» — это два слова.
        return BLOCK_TAGS.has(node.tag) ? ` ${inner} ` : inner;
      })
      .join("");
  const text = walk(parseHtml(html)).replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Все вложения, на которые ссылается разметка. Порядок — как в документе. */
export function attachmentIdsFromHtml(html: string | null | undefined): string[] {
  if (!html) return [];
  const ids = new Set<string>();
  for (const m of html.matchAll(/\/attachments\/([0-9a-f-]{36})/gi)) ids.add(m[1]);
  return [...ids];
}
