"use client";

// Выгрузка описания задачи в .docx: разметка Tiptap → документ Word.
//
// Собирается в браузере, а не на сервере, и это осознанно:
//   * Word открывает только png/jpg/gif/bmp, а редактор ужимает вставленные
//     картинки в webp (см. upload.ts) — перерисовать их без браузерного canvas
//     нечем, а тянуть на сервер нативный декодер ради одной кнопки дорого;
//   * картинки лежат за той же сессией, что и страница, — fetch с cookie
//     забирает их без отдельной авторизации;
//   * в документ уходит то, что человек видит прямо сейчас, включая правку,
//     которую автосохранение ещё не отправило.
//
// Обсуждения к тексту (doc-comments) становятся настоящими примечаниями Word:
// корень треда — примечание на том же фрагменте, ответы — ответы внутри него
// (`parentId`), закрытый тред помечен решённым.
//
// Модуль грузится динамически из DocxButton: docx весит немало, а нужен он
// только в момент нажатия.

import {
  AlignmentType,
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  HighlightColor,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ICommentOptions,
  type IIndentAttributesProperties,
  type IRunStylePropertiesOptions,
  type ParagraphChild,
} from "docx";
import type { DocCommentMessage, DocCommentThread } from "@/lib/core/types";

/** Ширина колонки текста при полях в 2 см — предел для картинки. */
const CONTENT_WIDTH_PX = 600;
const MONO_FONT = "Consolas";
const MUTED = "71717A";
const LINK_COLOR = "0563C1";
const ORDERED_REF = "doc-ordered";
/** Отступ одного уровня вложенности, в twip (1/20 пункта). */
const INDENT_STEP = 480;

type Block = Paragraph | Table;
type RunStyle = IRunStylePropertiesOptions;

type LoadedImage = {
  data: Uint8Array;
  type: "png" | "jpg" | "gif" | "bmp";
  width: number;
  height: number;
};

/** Диапазон якорей одного треда: между первым и последним ставится примечание. */
type Anchor = { first: Element; last: Element };

type BuildContext = {
  images: Map<string, LoadedImage>;
  anchors: Map<string, Anchor>;
  /** Тред → id всех его примечаний Word: корень первым, дальше ответы. */
  threadComments: Map<string, number[]>;
  /** Счётчик независимых нумераций: два списка подряд не должны продолжать друг друга. */
  nextOrderedInstance: () => number;
};

type BlockOptions = { indent?: IIndentAttributesProperties };

const HEADINGS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5,
  h6: HeadingLevel.HEADING_6,
};

const BLOCK_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "blockquote", "pre", "hr", "figure", "table", "div",
]);

const ALIGNMENTS: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

// ─── разбор HTML ────────────────────────────────────────────────────────────

/**
 * Разметка описания → отдельный документ.
 *
 * DOMParser безопасен: скрипты в отсоединённом документе не выполняются, а
 * картинки и стили не загружаются. Живой узел вместо строки нужен потому, что
 * порядок якорей комментариев считается обходом дерева.
 */
function parseFragment(html: string): HTMLElement {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
}

function isElement(node: ChildNode): node is Element {
  return node.nodeType === 1;
}

function styleOf(el: Element): CSSStyleDeclaration | null {
  return el instanceof HTMLElement ? el.style : null;
}

function alignmentOf(el: Element): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const value = styleOf(el)?.textAlign || el.getAttribute("data-align") || "";
  return ALIGNMENTS[value];
}

/** Ссылка в документе должна открываться и вне приложения — относительную разворачиваем. */
function absoluteUrl(href: string): string {
  try {
    return new URL(href, window.location.origin).toString();
  } catch {
    return href;
  }
}

// ─── картинки ───────────────────────────────────────────────────────────────

/** Форматы, которые Word берёт как есть. Всё остальное перерисовываем в PNG. */
const RAW_IMAGE_TYPES: Record<string, LoadedImage["type"]> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

async function loadImage(src: string): Promise<LoadedImage | null> {
  try {
    const response = await fetch(src, { credentials: "same-origin" });
    if (!response.ok) return null;
    const blob = await response.blob();
    // Размеры берём у декодера, а не у разметки: в описании ширина задана
    // в CSS и о настоящих пропорциях файла ничего не говорит.
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;

    const raw = RAW_IMAGE_TYPES[blob.type.toLowerCase()];
    if (raw) {
      bitmap.close();
      return { data: new Uint8Array(await blob.arrayBuffer()), type: raw, width, height };
    }

    // webp и avif Word не открывает — но браузер их уже раскодировал.
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return null;
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) return null;
    return { data: new Uint8Array(await png.arrayBuffer()), type: "png", width, height };
  } catch {
    // Битая ссылка не должна ронять выгрузку целиком: на месте картинки
    // останется её подпись.
    return null;
  }
}

/** Все картинки описания и комментариев — одной пачкой, до сборки документа. */
async function loadImages(roots: readonly ParentNode[]): Promise<Map<string, LoadedImage>> {
  const sources = new Set<string>();
  for (const root of roots) {
    for (const img of Array.from(root.querySelectorAll("img[src]"))) {
      const src = img.getAttribute("src");
      if (src) sources.add(src);
    }
  }
  const loaded = await Promise.all(
    Array.from(sources, async (src) => [src, await loadImage(src)] as const),
  );
  const map = new Map<string, LoadedImage>();
  for (const [src, image] of loaded) if (image) map.set(src, image);
  return map;
}

const CSS_WIDTH_RE = /^(\d+(?:\.\d+)?)(px|%)$/;

function imageSize(image: LoadedImage, cssWidth: string | null): { width: number; height: number } {
  const match = cssWidth ? CSS_WIDTH_RE.exec(cssWidth.trim()) : null;
  let width = Math.min(image.width, CONTENT_WIDTH_PX);
  if (match) {
    const value = Number(match[1]);
    width = match[2] === "%" ? (CONTENT_WIDTH_PX * value) / 100 : value;
  }
  width = Math.max(16, Math.min(CONTENT_WIDTH_PX, Math.round(width)));
  return { width, height: Math.max(16, Math.round((width * image.height) / image.width)) };
}

function imageRuns(img: Element, ctx: BuildContext, cssWidth?: string | null): ParagraphChild[] {
  const src = img.getAttribute("src") ?? "";
  const image = ctx.images.get(src);
  const alt = img.getAttribute("alt")?.trim() ?? "";
  if (!image) {
    return alt ? [new TextRun({ text: `[${alt}]`, italics: true, color: MUTED })] : [];
  }
  const width = cssWidth ?? styleOf(img)?.width ?? null;
  return [
    new ImageRun({
      type: image.type,
      data: image.data,
      transformation: imageSize(image, width),
      altText: alt ? { name: alt, description: alt, title: alt } : undefined,
    }),
  ];
}

// ─── инлайн ─────────────────────────────────────────────────────────────────

function runsFromNodes(
  nodes: Iterable<ChildNode>,
  style: RunStyle,
  ctx: BuildContext,
): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const node of nodes) out.push(...runsFromNode(node, style, ctx));
  return out;
}

function runsFromNode(node: ChildNode, style: RunStyle, ctx: BuildContext): ParagraphChild[] {
  if (node.nodeType === 3) {
    const text = node.nodeValue ?? "";
    return text ? [new TextRun({ text, ...style })] : [];
  }
  if (!isElement(node)) return [];

  const el = node;
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "br":
      return [new TextRun({ break: 1 })];
    case "strong":
    case "b":
      return runsFromNodes(el.childNodes, { ...style, bold: true }, ctx);
    case "em":
    case "i":
      return runsFromNodes(el.childNodes, { ...style, italics: true }, ctx);
    case "u":
      return runsFromNodes(el.childNodes, { ...style, underline: {} }, ctx);
    case "s":
    case "del":
    case "strike":
      return runsFromNodes(el.childNodes, { ...style, strike: true }, ctx);
    case "code":
      return runsFromNodes(
        el.childNodes,
        { ...style, font: MONO_FONT, shading: { type: ShadingType.CLEAR, fill: "F1F1F1" } },
        ctx,
      );
    case "mark":
      return runsFromNodes(el.childNodes, { ...style, highlight: HighlightColor.YELLOW }, ctx);
    case "img":
      return imageRuns(el, ctx);
    case "a": {
      const href = el.getAttribute("href");
      const inner = runsFromNodes(
        el.childNodes,
        { ...style, color: LINK_COLOR, underline: {} },
        ctx,
      );
      if (!href || !inner.length) return inner;
      return [new ExternalHyperlink({ children: inner, link: absoluteUrl(href) })];
    }
    case "span": {
      // Упоминание — не ссылка: в документе за пределами приложения по нему
      // всё равно некуда идти, поэтому просто выделенное имя.
      if (el.getAttribute("data-type") === "mention") {
        return runsFromNodes(el.childNodes, { ...style, bold: true, color: "B4552F" }, ctx);
      }
      const threadId = el.getAttribute("data-comment");
      if (threadId) return commentedRuns(el, threadId, style, ctx);
      return runsFromNodes(el.childNodes, style, ctx);
    }
    default:
      return runsFromNodes(el.childNodes, style, ctx);
  }
}

/**
 * Фрагмент под примечанием.
 *
 * Диапазон получает не только корень треда, но и каждый ответ — на тот же
 * кусок текста. Ответ без собственной ссылки в теле документа Word считает
 * висячим и выбрасывает при открытии файла: `parentId` связывает примечания в
 * ветку, но не заменяет якорь.
 *
 * Правка текста рвёт якорь на несколько span'ов, а открыть и закрыть диапазон
 * с одним id можно только раз. Поэтому диапазоны открываются на первом куске и
 * закрываются на последнем — между ними может лежать хоть половина документа,
 * для OOXML это законно.
 */
function commentedRuns(
  el: Element,
  threadId: string,
  style: RunStyle,
  ctx: BuildContext,
): ParagraphChild[] {
  const inner = runsFromNodes(el.childNodes, style, ctx);
  const ids = ctx.threadComments.get(threadId);
  const anchor = ctx.anchors.get(threadId);
  if (!ids?.length || !anchor) return inner;

  const out: ParagraphChild[] = [];
  if (anchor.first === el) for (const id of ids) out.push(new CommentRangeStart(id));
  out.push(...inner);
  if (anchor.last === el) {
    for (const id of ids) {
      out.push(new CommentRangeEnd(id));
      out.push(new TextRun({ children: [new CommentReference(id)] }));
    }
  }
  return out;
}

// ─── блоки ──────────────────────────────────────────────────────────────────

function blocksFromNodes(
  nodes: Iterable<ChildNode>,
  ctx: BuildContext,
  opts: BlockOptions,
): Block[] {
  const out: Block[] = [];
  let inline: ChildNode[] = [];

  const flush = () => {
    if (!inline.length) return;
    const runs = runsFromNodes(inline, {}, ctx);
    inline = [];
    if (runs.length) out.push(new Paragraph({ children: runs, indent: opts.indent }));
  };

  for (const node of nodes) {
    if (isElement(node) && BLOCK_TAGS.has(node.tagName.toLowerCase())) {
      flush();
      const blocks = blockFromElement(node, ctx, opts);
      // Две таблицы подряд Word склеивает в одну — разделяем их пустым абзацем.
      // Иначе колонки (тоже таблица) срастаются со следующей за ними таблицей.
      if (blocks[0] instanceof Table && out[out.length - 1] instanceof Table) {
        out.push(new Paragraph({}));
      }
      out.push(...blocks);
      continue;
    }
    // Перевод строки между блоками разметки — не текст документа.
    if (node.nodeType === 3 && !(node.nodeValue ?? "").trim()) continue;
    inline.push(node);
  }
  flush();
  return out;
}

function blockFromElement(el: Element, ctx: BuildContext, opts: BlockOptions): Block[] {
  const tag = el.tagName.toLowerCase();
  const alignment = alignmentOf(el);

  if (HEADINGS[tag]) {
    return [
      new Paragraph({
        children: runsFromNodes(el.childNodes, {}, ctx),
        heading: HEADINGS[tag],
        alignment,
        indent: opts.indent,
      }),
    ];
  }

  switch (tag) {
    case "p": {
      const children = runsFromNodes(el.childNodes, {}, ctx);
      // Пустой абзац в описании — сознательный отступ, его сохраняем.
      return [new Paragraph({ children, alignment, indent: opts.indent })];
    }
    case "ul":
    case "ol":
      return listBlocks(el, ctx, 0);
    case "blockquote":
      return blocksFromNodes(el.childNodes, ctx, {
        indent: { left: (Number(opts.indent?.left) || 0) + INDENT_STEP },
      });
    case "pre":
      return codeBlocks(el, opts);
    case "hr":
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "D4D4D8" } },
          spacing: { before: 160, after: 160 },
        }),
      ];
    case "figure":
      return figureBlocks(el, ctx, opts);
    case "table":
      return [tableBlock(el, ctx)];
    case "div": {
      if (el.hasAttribute("data-columns")) return [columnsBlock(el, ctx)];
      if (el.hasAttribute("data-file")) return fileBlocks(el, opts);
      return blocksFromNodes(el.childNodes, ctx, opts);
    }
    default:
      return blocksFromNodes(el.childNodes, ctx, opts);
  }
}

/**
 * Список. Вложенный `ol` внутри `ol` продолжает ту же нумерацию (уровнем
 * ниже), а любой список верхнего уровня получает свою — иначе два перечня
 * подряд считались бы одним.
 *
 * Пункт из нескольких абзацев склеивается переводом строки: маркер в Word
 * ставится на абзац, и второй абзац пункта получил бы собственный номер.
 */
function listBlocks(
  list: Element,
  ctx: BuildContext,
  level: number,
  instance?: number,
): Block[] {
  const ordered = list.tagName.toLowerCase() === "ol";
  const listInstance = ordered ? (instance ?? ctx.nextOrderedInstance()) : undefined;
  const out: Block[] = [];

  for (const item of Array.from(list.children)) {
    if (item.tagName.toLowerCase() !== "li") continue;

    const children: ParagraphChild[] = [];
    const nested: Block[] = [];
    let paragraphs = 0;

    for (const node of Array.from(item.childNodes)) {
      const tag = isElement(node) ? node.tagName.toLowerCase() : "";
      if (tag === "ul" || tag === "ol") {
        const inherited = tag === "ol" && ordered ? listInstance : undefined;
        nested.push(...listBlocks(node as Element, ctx, Math.min(level + 1, 4), inherited));
      } else if (tag === "p") {
        if (paragraphs > 0) children.push(new TextRun({ break: 1 }));
        paragraphs += 1;
        children.push(...runsFromNodes(node.childNodes, {}, ctx));
      } else {
        children.push(...runsFromNode(node, {}, ctx));
      }
    }

    out.push(
      new Paragraph(
        ordered
          ? { children, numbering: { reference: ORDERED_REF, level, instance: listInstance } }
          : { children, bullet: { level } },
      ),
    );
    out.push(...nested);
  }
  return out;
}

function codeBlocks(pre: Element, opts: BlockOptions): Block[] {
  const lines = (pre.textContent ?? "").replace(/\n$/, "").split("\n");
  return lines.map(
    (line) =>
      new Paragraph({
        // Пустая строка внутри кода должна занимать место, иначе блок «съезжает».
        children: [new TextRun({ text: line || " ", font: MONO_FONT, size: 20 })],
        shading: { type: ShadingType.CLEAR, fill: "F4F4F5" },
        spacing: { before: 0, after: 0 },
        indent: opts.indent,
      }),
  );
}

function figureBlocks(figure: Element, ctx: BuildContext, opts: BlockOptions): Block[] {
  const out: Block[] = [];
  const alignment = alignmentOf(figure);
  const img = figure.querySelector("img");
  if (img) {
    // Ширину картинки редактор пишет на `figure`, а не на самой `img`.
    const runs = imageRuns(img, ctx, styleOf(figure)?.width || null);
    if (runs.length) out.push(new Paragraph({ children: runs, alignment, indent: opts.indent }));
  }
  const caption = figure.querySelector("figcaption")?.textContent?.trim();
  if (caption) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: caption, italics: true, size: 18, color: MUTED })],
        alignment,
        indent: opts.indent,
      }),
    );
  }
  return out;
}

function cellBlocks(cell: Element, ctx: BuildContext): Block[] {
  const blocks = blocksFromNodes(cell.childNodes, ctx, {});
  // Ячейка без единого абзаца — невалидный docx, Word откажется открывать файл.
  return blocks.length ? blocks : [new Paragraph({})];
}

function tableBlock(table: Element, ctx: BuildContext): Table {
  const rows: TableRow[] = [];
  for (const tr of Array.from(table.querySelectorAll("tr"))) {
    const cells: TableCell[] = [];
    for (const cell of Array.from(tr.children)) {
      const tag = cell.tagName.toLowerCase();
      if (tag !== "td" && tag !== "th") continue;
      cells.push(
        new TableCell({
          children: cellBlocks(cell, ctx),
          columnSpan: Number(cell.getAttribute("colspan")) || undefined,
          rowSpan: Number(cell.getAttribute("rowspan")) || undefined,
          shading: tag === "th" ? { type: ShadingType.CLEAR, fill: "F4F4F5" } : undefined,
        }),
      );
    }
    if (cells.length) rows.push(new TableRow({ children: cells }));
  }
  if (!rows.length) {
    rows.push(new TableRow({ children: [new TableCell({ children: [new Paragraph({})] })] }));
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

const INVISIBLE_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;

/**
 * Раскладка в колонки — таблица без рамок в одну строку. Прямого аналога
 * «колонок на кусок страницы» в Word нет: секционные колонки делят страницу
 * целиком, а не абзац.
 */
function columnsBlock(el: Element, ctx: BuildContext): Table {
  const columns = Array.from(el.children).filter((child) => child.hasAttribute("data-column"));
  const list = columns.length ? columns : [el];
  return new Table({
    rows: [
      new TableRow({
        children: list.map(
          (column) =>
            new TableCell({
              children: cellBlocks(column, ctx),
              borders: {
                top: INVISIBLE_BORDER,
                bottom: INVISIBLE_BORDER,
                left: INVISIBLE_BORDER,
                right: INVISIBLE_BORDER,
              },
            }),
        ),
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: INVISIBLE_BORDER,
      bottom: INVISIBLE_BORDER,
      left: INVISIBLE_BORDER,
      right: INVISIBLE_BORDER,
      insideHorizontal: INVISIBLE_BORDER,
      insideVertical: INVISIBLE_BORDER,
    },
  });
}

/** Вложенный файл: содержимое в документ не тянем, остаётся ссылка на него. */
function fileBlocks(el: Element, opts: BlockOptions): Block[] {
  const link = el.querySelector("a");
  const name = el.getAttribute("data-file-name") || link?.textContent?.trim() || "Файл";
  const href = link?.getAttribute("href");
  const run = new TextRun({
    text: `📎 ${name}`,
    color: href ? LINK_COLOR : undefined,
    underline: href ? {} : undefined,
  });
  return [
    new Paragraph({
      children: href ? [new ExternalHyperlink({ children: [run], link: absoluteUrl(href) })] : [run],
      indent: opts.indent,
    }),
  ];
}

// ─── обсуждения ─────────────────────────────────────────────────────────────

function collectAnchors(root: ParentNode): Map<string, Anchor> {
  const anchors = new Map<string, Anchor>();
  // querySelectorAll отдаёт узлы в порядке документа — первый и последний
  // якорь треда берутся отсюда без отдельной сортировки.
  for (const el of Array.from(root.querySelectorAll("span[data-comment]"))) {
    const id = el.getAttribute("data-comment");
    if (!id) continue;
    const current = anchors.get(id);
    if (current) current.last = el;
    else anchors.set(id, { first: el, last: el });
  }
  return anchors;
}

function authorName(message: DocCommentMessage): string {
  return message.author?.name?.trim() || message.author?.email || "Участник";
}

function initialsOf(name: string): string {
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
}

/** Корень треда пишут первым, но полагаться на порядок выборки не будем. */
function orderedMessages(thread: DocCommentThread): DocCommentMessage[] {
  const root = thread.messages.find((message) => message.id === thread.id);
  if (!root) return thread.messages;
  return [root, ...thread.messages.filter((message) => message !== root)];
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/**
 * Треды с якорем → примечания Word. Ответы уходят в тот же тред примечания
 * через `parentId`, закрытое обсуждение помечается решённым.
 */
function buildComments(
  threads: readonly DocCommentThread[],
  bodies: Map<string, HTMLElement>,
  ctx: BuildContext,
): ICommentOptions[] {
  const comments: ICommentOptions[] = [];
  let nextId = 0;

  for (const thread of threads) {
    if (!ctx.anchors.has(thread.id)) continue;
    const rootId = nextId++;
    const ids = [rootId];
    ctx.threadComments.set(thread.id, ids);
    const resolved = Boolean(thread.resolved_at);

    orderedMessages(thread).forEach((message, index) => {
      const body = bodies.get(message.id);
      const children = body ? blocksFromNodes(body.childNodes, ctx, {}) : [];
      const name = authorName(message);
      const id = index === 0 ? rootId : nextId++;
      if (index > 0) ids.push(id);
      comments.push({
        id,
        parentId: index === 0 ? undefined : rootId,
        author: name,
        initials: initialsOf(name),
        date: new Date(message.created_at),
        resolved,
        // Примечание без абзацев Word показывает пустым.
        children: children.length ? children.filter((block) => block instanceof Paragraph) : [new Paragraph({})],
      });
    });
  }
  return comments;
}

/**
 * Обсуждения, потерявшие якорь (фрагмент вырезали правкой), — отдельным
 * разделом в конце: примечанию не за что зацепиться, а терять переписку нельзя.
 */
function orphanBlocks(
  threads: readonly DocCommentThread[],
  bodies: Map<string, HTMLElement>,
  ctx: BuildContext,
): Block[] {
  const orphans = threads.filter((thread) => !ctx.anchors.has(thread.id));
  if (!orphans.length) return [];

  const out: Block[] = [
    new Paragraph({
      text: "Обсуждения без привязки к тексту",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 480 },
    }),
  ];

  for (const thread of orphans) {
    if (thread.quote) {
      out.push(
        new Paragraph({
          children: [new TextRun({ text: `«${thread.quote}»`, italics: true, color: MUTED })],
        }),
      );
    }
    for (const message of orderedMessages(thread)) {
      const stamp = [authorName(message), formatDate(message.created_at)]
        .filter(Boolean)
        .join(" · ");
      out.push(
        new Paragraph({
          children: [new TextRun({ text: stamp, bold: true, size: 18 })],
          indent: { left: INDENT_STEP },
        }),
      );
      const body = bodies.get(message.id);
      if (body) out.push(...blocksFromNodes(body.childNodes, ctx, { indent: { left: INDENT_STEP } }));
    }
  }
  return out;
}

// ─── документ ───────────────────────────────────────────────────────────────

/**
 * Одна нумерация на весь документ. Отдельные перечни разводит `instance` в
 * самом абзаце — библиотека заводит под каждый номер свой экземпляр.
 */
const NUMBERING = {
  config: [
    {
      reference: ORDERED_REF,
      levels: [0, 1, 2, 3, 4].map((level) => ({
        level,
        format: LevelFormat.DECIMAL,
        text: `%${level + 1}.`,
        alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
      })),
    },
  ],
};

/** Имя файла: без разделителей пути и запрещённых в Windows символов. */
function docxFilename(title: string): string {
  const base = title.replace(/[\\/:*?"<>| -]/g, " ").replace(/\s+/g, " ").trim();
  return `${(base || "Задача").slice(0, 100)}.docx`;
}

export interface DocxExportInput {
  /** Заголовок задачи — первой строкой документа и именем файла. */
  title: string;
  /** Разметка описания в том виде, в каком её показывает редактор. */
  html: string;
  /** Обсуждения к тексту: анкерованные станут примечаниями Word. */
  threads: readonly DocCommentThread[];
}

/** Собирает .docx и отдаёт его браузеру на скачивание. */
export async function downloadTaskDocx({ title, html, threads }: DocxExportInput): Promise<void> {
  const root = parseFragment(html);

  // Тела комментариев разбираем заранее: их картинки грузятся тем же заходом,
  // что и картинки описания.
  const bodies = new Map<string, HTMLElement>();
  for (const thread of threads) {
    for (const message of thread.messages) bodies.set(message.id, parseFragment(message.body));
  }

  const images = await loadImages([root, ...bodies.values()]);

  let orderedInstances = 0;
  const ctx: BuildContext = {
    images,
    anchors: collectAnchors(root),
    threadComments: new Map(),
    // Нулевой экземпляр библиотека держит за конфигурацией по умолчанию.
    nextOrderedInstance: () => ++orderedInstances,
  };

  // Примечания собираются первыми: обход описания уже должен знать, каким id
  // помечать якорь.
  const comments = buildComments(threads, bodies, ctx);
  const body = blocksFromNodes(root.childNodes, ctx, {});
  const orphans = orphanBlocks(threads, bodies, ctx);

  const document_ = new Document({
    title,
    description: "Описание задачи",
    comments: { children: comments },
    numbering: NUMBERING,
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
          ...body,
          ...orphans,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(document_);
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = docxFilename(title);
  link.click();
  // Отзывать ссылку сразу нельзя: скачивание стартует после текущего кадра.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
