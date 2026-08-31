import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { getKbDocument } from "@/lib/core/kb";
import { sheetToCsv } from "@/lib/core/sheet/csv";
import { recalculate } from "@/lib/core/sheet/engine";
import { cellRef, parseWorkbook } from "@/lib/core/sheet/model";
import { csvCellText, workbookToXlsx } from "@/lib/core/sheet/xlsx";

/**
 * Выгрузка таблицы: `?format=xlsx` или `?format=csv`.
 *
 * Собирается на сервере, в отличие от выгрузки описания в .docx (та живёт в
 * браузере — ей нужны картинки за сессией и правка, которую автосохранение ещё
 * не отправило). У таблицы обеих причин нет: картинок в ячейках не бывает, а
 * книга уезжает на сервер тем же автосохранением, что и текст.
 *
 * Книга пересчитывается перед выгрузкой: в ячейках лежит последнее посчитанное
 * значение, и если файл открыли вкладкой со старым кодом — оно могло устареть.
 */
export const GET = withOrg(async (request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");

  const document = await getKbDocument(auth, docId);
  if (document.kind !== "sheet") return jsonError(422, "Выгружать можно только таблицу");

  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const workbook = parseWorkbook(document.body);
  recalculate(workbook);

  const name = (document.title || "Таблица").replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);

  if (format === "csv") {
    // csv не знает о нескольких листах: выгружаем тот, что попросили, по
    // умолчанию первый. Номер приходит из интерфейса — там виден активный.
    const index = Number(new URL(request.url).searchParams.get("sheet") ?? 0);
    const sheet = workbook.sheets[Number.isInteger(index) ? index : 0] ?? workbook.sheets[0];
    const csv = sheetToCsv(sheet, (row, col) => {
      const cell = sheet.cells[cellRef(row, col)];
      return csvCellText(cell, cell?.s === undefined ? undefined : workbook.styles[cell.s]);
    });
    return fileResponse(new TextEncoder().encode(csv), "text/csv; charset=utf-8", `${name}.csv`);
  }

  const buffer = await workbookToXlsx(workbook, name);
  return fileResponse(
    new Uint8Array(buffer),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    `${name}.xlsx`,
  );
});

/**
 * Ответ файлом. Имя дублируется в `filename*` по RFC 5987: без него браузер
 * теряет кириллицу в названии и сохраняет «______.xlsx».
 */
// `Uint8Array<ArrayBuffer>`, а не просто `Uint8Array`: тело ответа не принимает
// массив над разделяемой памятью, и разница видна только тайпчекеру.
function fileResponse(
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
  filename: string,
): NextResponse {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(bytes.byteLength),
      // Ответ зависит от прав смотрящего и от последней правки — общему кэшу
      // его отдавать нельзя, а своему незачем.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
