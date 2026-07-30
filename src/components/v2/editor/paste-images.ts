"use client";

// Картинки из вставленной разметки уезжают во вложения.
//
// Зачем: документ с картинками кладётся в буфер вместе с ними — Word и Google
// Docs отдают их прямо в разметке, закодированными в base64. Полтора мегабайта
// картинок превращаются в два мегабайта текста, и описание перестаёт помещаться
// в предел сохранения: сервер отвечает «Too big», и вставка не сохраняется
// вообще. Картинка, вставленная файлом, этой беды не знает — она сразу уходит
// во вложения, и в описании остаётся короткая ссылка. Здесь то же самое
// делается для картинок, приехавших внутри разметки.
//
// Разметка правится до разбора (`transformPastedHTML`), а не после вставки:
// иначе base64 успел бы попасть в документ, а оттуда — в автосохранение.

import type { Editor } from "@tiptap/core";

/** Картинка, ожидающая загрузки: метка в документе и откуда её брать. */
export interface PendingImage {
  id: string;
  src: string;
}

let counter = 0;

/** Наш же роут отдачи вложений — такую картинку перекладывать некуда. */
function isOwnAttachment(src: string): boolean {
  return src.startsWith("/api/v2/");
}

/**
 * Стоит ли забирать картинку себе.
 *
 * `data:` — тот самый base64 из документа. Внешние адреса тоже забираем: чужая
 * ссылка живёт ровно столько, сколько её держит источник, и однажды картинка в
 * описании просто перестаёт открываться.
 *
 * `file:` сюда не входит намеренно: браузер такие пути не читает, и загрузить
 * их всё равно нечем.
 */
function isUploadable(src: string): boolean {
  if (!src || isOwnAttachment(src)) return false;
  return src.startsWith("data:image/") || /^https?:\/\//i.test(src);
}

/**
 * Заменить в разметке источники картинок метками и вернуть список к загрузке.
 * Пустой `src` вместо адреса — чтобы в документ не попал ни байт base64.
 */
export function extractPastedImages(html: string): { html: string; pending: PendingImage[] } {
  if (!html.includes("<img")) return { html, pending: [] };
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const pending: PendingImage[] = [];
  for (const img of Array.from(holder.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    if (!isUploadable(src)) continue;
    const id = `paste-${Date.now().toString(36)}-${++counter}`;
    pending.push({ id, src });
    img.setAttribute("src", "");
    img.setAttribute("data-upload", id);
  }
  return pending.length ? { html: holder.innerHTML, pending } : { html, pending: [] };
}

const DATA_URL_RE = /^data:([^;,]+)(;base64)?,([\s\S]*)$/;

/** Расширение по типу: имя файла уходит в подпись вложения и в ссылку. */
function extensionOf(mime: string): string {
  const known: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
  };
  return known[mime] ?? "png";
}

/** Достать байты картинки: из самой ссылки (`data:`) или запросом. */
export async function fileFromImageSrc(src: string, index: number): Promise<File> {
  const data = DATA_URL_RE.exec(src);
  if (data) {
    const [, mime, base64, payload] = data;
    const bytes = base64
      ? Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(payload));
    return new File([bytes], `image-${index}.${extensionOf(mime)}`, { type: mime });
  }
  // Чужой домен может не отдать картинку скрипту (CORS) — тогда бросит, и
  // вызывающий оставит ссылку как была.
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Источник ответил ${response.status}`);
  const blob = await response.blob();
  const mime = blob.type || "image/png";
  return new File([blob], `image-${index}.${extensionOf(mime)}`, { type: mime });
}

/** Позиция картинки с этой меткой. Метка своя у каждой — хватает первой. */
function findByUploadId(editor: Editor, id: string): { pos: number; size: number; attrs: Record<string, unknown> } | null {
  const type = editor.state.schema.nodes.docImage;
  if (!type) return null;
  let hit: { pos: number; size: number; attrs: Record<string, unknown> } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (hit) return false;
    if (node.type !== type || node.attrs.uploadId !== id) return true;
    hit = { pos, size: node.nodeSize, attrs: { ...node.attrs } };
    return false;
  });
  return hit;
}

/** Картинка загрузилась: подставить наш адрес и снять метку. */
export function settlePastedImage(editor: Editor, id: string, src: string): void {
  const hit = findByUploadId(editor, id);
  if (!hit) return;
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(hit.pos, undefined, { ...hit.attrs, src, uploadId: null }),
  );
}

/**
 * Загрузить не вышло.
 *
 * Внешнюю ссылку возвращаем на место: картинка хотя бы видна, пока жив её
 * источник. `data:` вернуть нельзя — именно он и не помещается в описание,
 * поэтому место картинки убираем совсем, а вызывающий скажет об этом человеку.
 */
export function revertPastedImage(editor: Editor, image: PendingImage): void {
  const hit = findByUploadId(editor, image.id);
  if (!hit) return;
  const tr = editor.state.tr;
  if (image.src.startsWith("data:")) tr.delete(hit.pos, hit.pos + hit.size);
  else tr.setNodeMarkup(hit.pos, undefined, { ...hit.attrs, src: image.src, uploadId: null });
  editor.view.dispatch(tr);
}
