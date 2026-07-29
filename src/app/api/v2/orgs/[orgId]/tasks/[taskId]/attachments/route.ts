import { NextResponse } from "next/server";
import {
  ATTACHMENT_MAX_BYTES,
  listTaskAttachments,
  uploadAttachment,
} from "@/lib/core/attachments";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";

export const GET = withOrg(async (_request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  return NextResponse.json(await listTaskAttachments(auth, taskId));
});

/**
 * Загрузка файла в описание задачи. Тело — multipart/form-data, а не JSON:
 * base64 в JSON раздул бы 10-мегабайтный файл до 13 МБ и заставил бы держать
 * его строкой в памяти дважды.
 *
 * `width`/`height` присылает браузер: сервер не разбирает картинку (это
 * означало бы нативную зависимость в образе), а размеры нужны, чтобы место под
 * изображение резервировалось до его загрузки.
 */
export const POST = withOrg(async (request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Ожидается multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "Поле file обязательно");
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return jsonError(413, `Файл больше ${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)} МБ`);
  }

  const toDimension = (raw: FormDataEntryValue | null): number | null => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 && n <= 20000 ? Math.round(n) : null;
  };

  const attachment = await uploadAttachment(auth, taskId, {
    filename: file.name,
    mimeType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    width: toDimension(form.get("width")),
    height: toDimension(form.get("height")),
  });
  return NextResponse.json(attachment, { status: 201 });
});
