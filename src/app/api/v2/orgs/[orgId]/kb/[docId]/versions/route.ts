import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { listKbVersions } from "@/lib/core/kb";

/** Список версий без тел: история на сотню правок весила бы мегабайты. */
export const GET = withOrg(async (_request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  return NextResponse.json(await listKbVersions(auth, docId));
});
