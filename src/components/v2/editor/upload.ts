"use client";

// Отправка вложений описания. Картинка перед отправкой ужимается в браузере:
// байты лежат в самой БД и попадают в каждый ежедневный бэкап, поэтому снимок
// экрана на 4000 px там оказаться не должен.

import type { Attachment } from "@/lib/core/types";
import { ownerPath, type DocOwner } from "./owner";

/** Дальше этой ширины изображение в описании ничего не выигрывает. */
const MAX_IMAGE_WIDTH = 1600;
/** Ниже этого веса пережимать нет смысла — только потеря качества. */
const RECOMPRESS_OVER_BYTES = 400 * 1024;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Форматы, которые мы умеем перерисовывать без потери смысла. */
const RESIZABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

type Prepared = { file: File; width: number | null; height: number | null };

/**
 * Размеры картинки и, если она великовата, её ужатая копия.
 *
 * GIF и AVIF не трогаем: первый потерял бы анимацию, второй уже сжат лучше
 * всего, во что мы можем его перерисовать.
 */
async function prepareImage(file: File): Promise<Prepared> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Формат, который браузер не декодирует, уходит как есть — сервер его
    // всё равно примет и отдаст загрузкой.
    return { file, width: null, height: null };
  }
  const { width, height } = bitmap;
  const needsResize =
    RESIZABLE.has(file.type) && (width > MAX_IMAGE_WIDTH || file.size > RECOMPRESS_OVER_BYTES);
  if (!needsResize) {
    bitmap.close();
    return { file, width, height };
  }

  const scale = Math.min(1, MAX_IMAGE_WIDTH / width);
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return { file, width, height };
  }
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.9),
  );
  // Пережатие иногда даёт файл тяжелее исходного (мелкие PNG с плоскими
  // заливками) — тогда отправляем оригинал.
  if (!blob || blob.size >= file.size) {
    return { file, width, height };
  }
  const name = file.name.replace(/\.[^.]+$/, "") || "image";
  return {
    file: new File([blob], `${name}.webp`, { type: "image/webp" }),
    width: targetWidth,
    height: targetHeight,
  };
}

export class UploadError extends Error {}

/** Загружает файл владельцу и возвращает метаданные вместе с готовым URL. */
export async function uploadAttachment(
  orgId: string,
  owner: DocOwner,
  input: File,
): Promise<Attachment> {
  const prepared = isImageFile(input)
    ? await prepareImage(input)
    : { file: input, width: null, height: null };

  if (prepared.file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError(
      `«${input.name}» больше ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБ`,
    );
  }

  const form = new FormData();
  form.append("file", prepared.file);
  if (prepared.width) form.append("width", String(prepared.width));
  if (prepared.height) form.append("height", String(prepared.height));

  // Не через lib/core/client: тот всегда шлёт JSON, а base64 раздул бы файл на
  // треть и заставил держать его в памяти дважды.
  const res = await fetch(`/api/v2${ownerPath(orgId, owner)}/attachments`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Не удалось загрузить «${input.name}»`;
    throw new UploadError(message);
  }
  return (await res.json()) as Attachment;
}

/** Картинки в описании отдаёт наш роут — по нему же узнаётся id вложения. */
export function isInlineImageMime(mime: string): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(
    mime.toLowerCase(),
  );
}
