import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { getKbVersion, restoreKbVersion } from "@/lib/core/kb";

export const GET = withOrg(async (_request, { params, auth }) => {
  const { docId, versionId } = await params;
  if (!isUuid(docId) || !isUuid(versionId)) return jsonError(404, "Версия не найдена");
  return NextResponse.json(await getKbVersion(auth, docId, versionId));
});

/** Возврат к версии — правка поверх текущей, история при этом не теряется. */
export const POST = withOrg(async (_request, { params, auth }) => {
  const { docId, versionId } = await params;
  if (!isUuid(docId) || !isUuid(versionId)) return jsonError(404, "Версия не найдена");
  return NextResponse.json(await restoreKbVersion(auth, docId, versionId));
});
