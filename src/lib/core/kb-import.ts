// Импорт файлов в базу знаний: .docx → документ, .xlsx/.csv → таблица.
//
// Только сервер: mammoth и exceljs весят вместе больше мегабайта, и в
// браузерный бандл им нельзя. Разбор идёт в роуте, страница получает уже
// готовый узел дерева.
//
// Порядок шагов важнее, чем кажется. Узел заводится ПЕРВЫМ и пустым, и только
// потом наполняется:
//   * картинки из .docx становятся вложениями, а вложению нужен владелец —
//     documentId существует лишь после вставки строки;
//   * наполнение идёт через `updateKbDocument`, то есть проходит те же правила,
//     что и обычная правка, и заводит первую версию в истории;
//   * оборвавшийся импорт оставляет пустой документ, а его через сутки уберёт
//     та же уборка, что убирает брошенные пустышки.
//
// Конвертируем смысл, а не вёрстку. Колонки, врезки, сноски, колонтитулы и
// нумерация страниц в .docx остаются в исходном файле — он хранится вложением,
// и его всегда можно скачать байт-в-байт.

import mammoth from "mammoth";
import { sanitizeRichText } from "@/lib/sanitize";
import { ATTACHMENT_MAX_BYTES, uploadAttachment } from "./attachments";
import { DomainError } from "./http";
import { createKbDocument, getKbDocument, updateKbDocument } from "./kb";
import { csvToWorkbook } from "./sheet/csv";
import { serializeWorkbook } from "./sheet/model";
import { workbookFromXlsx } from "./sheet/xlsx";
import type { AuthContext, KbDocumentDetail, KbNodeKind } from "./types";

/** Потолок на файл — тот же, что у вложений: исходник и хранится вложением. */
export const IMPORT_MAX_BYTES = ATTACHMENT_MAX_BYTES;

/** Картинок из одного .docx. Дальше это уже не документ, а альбом. */
const MAX_IMAGES = 200;

export type ImportFormat = "xlsx" | "csv" | "docx";

export interface KbImportInput {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  parentId?: string | null;
  projectIds?: string[];
  /** Оставить ли исходный файл во вложениях узла. По умолчанию да. */
  keepOriginal?: boolean;
}

export interface KbImportResult {
  document: KbDocumentDetail;
  /** Что не поместилось или перенеслось иначе — показываем человеку. */
  notes: string[];
}

const EXTENSIONS: Record<string, ImportFormat> = {
  xlsx: "xlsx",
  xlsm: "xlsx",
  csv: "csv",
  tsv: "csv",
  docx: "docx",
};

/**
 * Формат файла — по расширению, а не по MIME.
 *
 * Браузеры и операционные системы врут о типе: тот же .csv приезжает то
 * `text/csv`, то `application/vnd.ms-excel`, то пустой строкой. Расширение
 * человек видит сам, и по нему он и ожидает поведения.
 */
export function detectImportFormat(filename: string): ImportFormat | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return EXTENSIONS[ext] ?? null;
}

/** Какой узел получится из файла. Нужен интерфейсу до загрузки. */
export function nodeKindOf(format: ImportFormat): KbNodeKind {
  return format === "docx" ? "document" : "sheet";
}

/** Имя файла без расширения — заголовок будущего узла. */
function titleFrom(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.[^.]+$/, "").trim().slice(0, 200) || "Импорт";
}

export async function importKbFile(
  ctx: AuthContext,
  input: KbImportInput,
): Promise<KbImportResult> {
  const format = detectImportFormat(input.filename);
  if (!format) {
    throw new DomainError(415, "Поддерживаются файлы .docx, .xlsx и .csv");
  }
  if (input.bytes.byteLength === 0) throw new DomainError(422, "Файл пустой");
  if (input.bytes.byteLength > IMPORT_MAX_BYTES) {
    throw new DomainError(413, `Файл больше ${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)} МБ`);
  }

  const kind = nodeKindOf(format);
  const created = await createKbDocument(ctx, {
    title: titleFrom(input.filename),
    kind,
    parentId: input.parentId ?? null,
    projectIds: input.projectIds,
  });

  const notes: string[] = [];
  let body: string;

  if (format === "docx") {
    const converted = await htmlFromDocx(ctx, created.id, input.bytes);
    body = converted.html;
    notes.push(...converted.notes);
  } else if (format === "xlsx") {
    const converted = await workbookFromXlsx(input.bytes);
    body = serializeWorkbook(converted.workbook);
    notes.push(...converted.notes);
  } else {
    body = serializeWorkbook(csvToWorkbook(decodeText(input.bytes), titleFrom(input.filename)));
  }

  await updateKbDocument(ctx, created.id, { body });

  if (input.keepOriginal !== false) {
    try {
      await uploadAttachment(
        ctx,
        { kind: "document", documentId: created.id },
        {
          filename: input.filename,
          mimeType: input.mimeType || "application/octet-stream",
          bytes: input.bytes,
          // Ссылок на исходник в теле нет и не будет — без отметки уборка
          // осиротевших снесла бы его через сутки (миграция 0058).
          pinned: true,
        },
      );
    } catch {
      // Исходник — удобство, а не содержимое: не сохранился, значит просто
      // говорим об этом. Ронять импорт готового документа из-за этого нельзя.
      notes.push("Исходный файл не удалось сохранить во вложения");
    }
  }

  return { document: await getKbDocument(ctx, created.id), notes };
}

// --- .docx -----------------------------------------------------------------

/**
 * Word → HTML редактора. Соответствие стилей — умолчания mammoth (заголовки,
 * списки, таблицы, ссылки, начертание) плюс подчёркивание и зачёркивание:
 * без явного правила mammoth их выбрасывает, а в наших регламентах
 * подчёркиванием размечена половина смысла.
 */
async function htmlFromDocx(
  ctx: AuthContext,
  documentId: string,
  bytes: Uint8Array,
): Promise<{ html: string; notes: string[] }> {
  const notes: string[] = [];
  let images = 0;
  let failed = 0;

  const result = await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes) },
    {
      styleMap: ["u => u", "strike => s", "r[style-name='Strong'] => strong"],
      convertImage: mammoth.images.imgElement(async (image) => {
        if (images >= MAX_IMAGES) {
          failed++;
          return { src: "" };
        }
        try {
          const buffer = await image.read();
          if (buffer.length > ATTACHMENT_MAX_BYTES) {
            failed++;
            return { src: "" };
          }
          images++;
          const attachment = await uploadAttachment(
            ctx,
            { kind: "document", documentId },
            {
              filename: `image-${images}.${extensionOf(image.contentType)}`,
              mimeType: image.contentType || "image/png",
              bytes: new Uint8Array(buffer),
            },
          );
          // Типы mammoth беднее реализации: `altText` у картинки есть, а
          // возвращённые атрибуты попадают в тег как есть — на этом и держится
          // подпись из Word.
          const alt = (image as { altText?: string }).altText ?? "";
          return { src: attachment.url, alt } as { src: string };
        } catch {
          failed++;
          return { src: "" };
        }
      }),
    },
  );

  if (failed) notes.push(`Картинок не перенесено: ${failed}`);
  // Предупреждения mammoth — про неизвестные стили абзацев. Показываем первые
  // несколько: полный список на большом документе исчисляется сотнями.
  const warnings = [...new Set(result.messages.map((m) => m.message))].slice(0, 3);
  if (warnings.length) notes.push(...warnings.map((text) => `Word: ${text}`));

  // Картинка, которую не удалось сохранить, ушла бы пустым `<img src="">` —
  // в редакторе это дыра с иконкой сломанного файла.
  const html = result.value.replace(/<img[^>]*src=""[^>]*>/g, "");
  return { html: sanitizeRichText(html), notes };
}

function extensionOf(contentType: string | undefined): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
  };
  return map[(contentType ?? "").toLowerCase()] ?? "bin";
}

// --- Текстовые файлы -------------------------------------------------------

/**
 * Байты csv → текст.
 *
 * Кодировка не объявлена нигде: HTTP-заголовок для файла с диска браузер не
 * ставит. Порядок проверок — от однозначного к вероятному: метка порядка байтов,
 * затем строгий UTF-8, и только если он не разобрался — Windows-1251. Русские
 * выгрузки из 1С и старого Excel почти всегда во втором, а текст в нём почти
 * никогда не является корректным UTF-8, поэтому проверка надёжна.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("windows-1251").decode(bytes);
    } catch {
      // Сборка Node без полного ICU: единственное, что остаётся, — прочитать
      // как UTF-8 с заменой битых байтов. Текст будет с «ромбиками», но файл
      // хотя бы откроется.
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}
