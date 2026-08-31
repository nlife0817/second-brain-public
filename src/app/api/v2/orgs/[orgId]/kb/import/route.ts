import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { jsonError } from "@/lib/core/http";
import { importKbFile, IMPORT_MAX_BYTES } from "@/lib/core/kb-import";

/**
 * Загрузка файла в базу знаний: .docx становится документом, .xlsx и .csv —
 * таблицей.
 *
 * Тело — multipart/form-data, как у вложений: base64 раздул бы файл на треть.
 * Разбор идёт здесь, а не в браузере, потому что exceljs и mammoth весят вместе
 * больше мегабайта — тянуть их в бандл ради кнопки «Загрузить» незачем.
 *
 * Права те же, что у создания узла: их проверяет `createKbDocument` внутри —
 * правка родительской папки, `doc.create` в проектах или `kb.create.common`.
 */
export const POST = withOrg(async (request, { auth }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Ожидается multipart/form-data");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "Поле file обязательно");
  if (file.size > IMPORT_MAX_BYTES) {
    return jsonError(413, `Файл больше ${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)} МБ`);
  }

  const parentRaw = form.get("parent_id");
  const projectsRaw = form.get("project_ids");
  const projectIds =
    typeof projectsRaw === "string" && projectsRaw.trim()
      ? projectsRaw.split(",").map((id) => id.trim()).filter(Boolean).slice(0, 20)
      : undefined;

  const result = await importKbFile(auth, {
    filename: file.name,
    mimeType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    parentId: typeof parentRaw === "string" && parentRaw ? parentRaw : null,
    projectIds,
    keepOriginal: form.get("keep_original") !== "0",
  });

  return NextResponse.json(result, { status: 201 });
});
