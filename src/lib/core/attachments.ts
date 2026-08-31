// Вложения описания задачи: байты лежат в core.attachments (bytea), права
// целиком наследуются от задачи-владельца.
//
// Почему в БД, а не на диске: своего объектного хранилища нет, а том Docker не
// попадает в ежедневный pg_dump (deploy/backup.sh) — файлы пережили бы падение
// сервера только вместе с ним. Плата — вес дампа, поэтому файл ограничен
// ATTACHMENT_MAX_BYTES, а картинки браузер ужимает до отправки (см.
// components/v2/editor/upload.ts).

import { prepare } from "@/lib/sql";
import { DomainError } from "./http";
import { requireTaskAccess } from "./tasks";
import type { Attachment, AuthContext } from "./types";

/** Потолок на файл. Держать согласованным с подписью в интерфейсе загрузки. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Картинки, которые отдаём с настоящим Content-Type и рисуем в `<img>`.
 *
 * SVG в списке нет намеренно: это документ со скриптами, и отданный с нашего
 * origin он превращается в хранимую XSS. Всё, чего нет здесь, уходит как
 * application/octet-stream с Content-Disposition: attachment.
 */
const INLINE_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export function isInlineImage(mime: string): boolean {
  return INLINE_IMAGE_MIME.has(mime.toLowerCase());
}

/** Путь, по которому браузер заберёт файл. Строится в одном месте — его же ждёт санитайзер. */
export function attachmentUrl(orgId: string, attachmentId: string): string {
  return `/api/v2/orgs/${orgId}/attachments/${attachmentId}`;
}

type AttachmentRow = {
  id: string;
  org_id: string;
  task_id: string | null;
  document_id: string | null;
  filename: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  created_at: string;
};

function mapAttachment(r: AttachmentRow): Attachment {
  return { ...r, url: attachmentUrl(r.org_id, r.id) };
}

const ATTACHMENT_COLUMNS = `id, org_id, task_id, document_id, filename, mime_type, byte_size, width, height, created_at`;

/** Имя файла как заголовок: без управляющих символов, кавычек и путей. */
function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f"\\]/g, "").trim();
  return clean.slice(0, 200) || "file";
}

export interface UploadInput {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  width?: number | null;
  height?: number | null;
}

/**
 * Загрузка файла в задачу — право `comment`, а не `edit`.
 *
 * Вложение живёт не только в описании: картинку прикладывают и к комментарию, а
 * комментировать может тот, кому правка задачи недоступна (роль `commenter`,
 * гость). Требование `edit` означало бы, что комментатор видит поле для
 * картинки и получает на неё 403.
 *
 * Описание при этом защищено по-прежнему: сохраняет его `updateTask`, и он
 * требует `edit`. Загруженный мимо описания файл — это байты, на которые никто
 * не ссылается; их убирает уборка осиротевших вложений в тике cron.
 */
export async function uploadAttachment(
  ctx: AuthContext,
  taskId: string,
  input: UploadInput,
): Promise<Attachment> {
  await requireTaskAccess(ctx, taskId, "comment");
  if (input.bytes.byteLength === 0) throw new DomainError(422, "Файл пустой");
  if (input.bytes.byteLength > ATTACHMENT_MAX_BYTES) {
    throw new DomainError(413, `Файл больше ${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)} МБ`);
  }
  const mime = (input.mimeType || "application/octet-stream").toLowerCase().slice(0, 120);
  const row = await prepare<AttachmentRow>(
    `INSERT INTO core.attachments
       (org_id, task_id, uploaded_by, filename, mime_type, byte_size, width, height, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING ${ATTACHMENT_COLUMNS}`,
  ).get(
    ctx.orgId,
    taskId,
    ctx.user.id,
    safeFilename(input.filename),
    mime,
    input.bytes.byteLength,
    input.width ?? null,
    input.height ?? null,
    // Buffer — тот вид, в котором postgres.js кладёт значение в bytea.
    Buffer.from(input.bytes),
  );
  if (!row) throw new DomainError(500, "Не удалось сохранить файл");
  return mapAttachment(row);
}

export interface AttachmentBytes {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

/** Содержимое файла. Доступ — тот же, что к задаче: видишь задачу, видишь вложение. */
export async function getAttachmentBytes(
  ctx: AuthContext,
  attachmentId: string,
): Promise<AttachmentBytes> {
  const row = await prepare<{
    org_id: string;
    task_id: string;
    filename: string;
    mime_type: string;
    data: Uint8Array;
  }>(
    `SELECT org_id, task_id, filename, mime_type, data FROM core.attachments WHERE id = ?`,
  ).get(attachmentId);
  // 404, а не 403: чужой организации не подтверждаем существование файла.
  if (!row || row.org_id !== ctx.orgId) throw new DomainError(404, "Файл не найден");
  await requireTaskAccess(ctx, row.task_id, "view");
  return { filename: row.filename, mimeType: row.mime_type, bytes: Buffer.from(row.data) };
}

/** Метаданные вложений задачи — для списка «вложено в задачу». */
export async function listTaskAttachments(
  ctx: AuthContext,
  taskId: string,
): Promise<Attachment[]> {
  await requireTaskAccess(ctx, taskId, "view");
  const rows = await prepare<AttachmentRow>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM core.attachments WHERE task_id = ? ORDER BY created_at`,
  ).all(taskId);
  return rows.map(mapAttachment);
}

/**
 * Уборка файлов, на которые больше никто не ссылается.
 *
 * Вставленную и тут же удалённую картинку никто не «отвязывает» явно — запись
 * остаётся с байтами внутри и попадает в каждый бэкап. Сутки отсрочки нужны,
 * чтобы не снести файл, загруженный в открытый редактор, где описание ещё не
 * сохранено. Зовётся из тика cron.
 *
 * Ссылку ищем в трёх местах, а не только в описании: картинку прикладывают ещё
 * и к комментарию задачи, и к комментарию в панели обсуждения. Проверка одного
 * описания сносила бы такие картинки через сутки после отправки — комментарий
 * оставался бы с битым изображением.
 */
export async function purgeOrphanAttachments(): Promise<{ removed: number }> {
  const result = await prepare(
    `DELETE FROM core.attachments a
     USING core.tasks t
     WHERE t.id = a.task_id
       AND a.created_at < now() - interval '1 day'
       AND position(a.id::text in t.description) = 0
       AND NOT EXISTS (
         SELECT 1 FROM core.comments c
         WHERE c.entity_type = 'task' AND c.entity_id = a.task_id
           AND c.deleted_at IS NULL
           AND position(a.id::text in c.body) > 0
       )
       AND NOT EXISTS (
         SELECT 1 FROM core.doc_comments d
         WHERE d.task_id = a.task_id
           AND d.deleted_at IS NULL
           AND position(a.id::text in d.body) > 0
       )`,
  ).run();
  return { removed: result.changes };
}
