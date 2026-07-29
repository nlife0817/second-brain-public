import { NextResponse } from "next/server";
import { getAttachmentBytes, isInlineImage } from "@/lib/core/attachments";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";

/**
 * Отдача вложения.
 *
 * Файл приходит от пользователя и уезжает с нашего origin, поэтому в браузере
 * он не должен уметь ничего, кроме как быть картинкой:
 *   * настоящий Content-Type получают только растровые форматы из белого списка
 *     (SVG туда не входит — это документ со скриптами), остальное уходит как
 *     octet-stream с Content-Disposition: attachment;
 *   * `nosniff` не даёт браузеру угадать тип вопреки заголовку;
 *   * CSP `sandbox` обезвреживает случай, когда файл всё же откроют как документ.
 *
 * Кэш приватный: ответ зависит от прав смотрящего, и общему кэшу его отдавать
 * нельзя. Содержимое по id не меняется, отсюда `immutable`.
 */
export const GET = withOrg(async (_request, { params, auth }) => {
  const { attachmentId } = await params;
  if (!isUuid(attachmentId)) return jsonError(404, "Attachment not found");

  const file = await getAttachmentBytes(auth, attachmentId);
  const inline = isInlineImage(file.mimeType);
  const asciiName = file.filename.replace(/[^\x20-\x7e]/g, "_");

  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": inline ? file.mimeType : "application/octet-stream",
      "Content-Length": String(file.bytes.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
