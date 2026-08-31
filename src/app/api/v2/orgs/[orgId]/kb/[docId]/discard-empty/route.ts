import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { discardEmptyKbDocument } from "@/lib/core/kb";

/**
 * «Я ухожу со страницы — убери документ, если в него так ничего и не добавили».
 *
 * Пустоту решает сервер, а не браузер: иначе правило разошлось бы с уборкой в
 * тике cron. Ответ говорит, убрали ли — по нему интерфейс решает, обновлять ли
 * дерево.
 */
export const POST = withOrg(async (_request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  return NextResponse.json(await discardEmptyKbDocument(auth, docId));
});
