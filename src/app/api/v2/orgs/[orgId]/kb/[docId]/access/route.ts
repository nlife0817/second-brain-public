import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { setKbDefaultRole } from "@/lib/core/kb";
import { kbAccessSchema } from "@/lib/core/schemas";

/** Базовая роль общего документа; `null` — закрытый, только по списку. */
export const PUT = withOrg(async (request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  const [body, invalid] = await parseJson(request, kbAccessSchema);
  if (invalid) return invalid;
  return NextResponse.json(await setKbDefaultRole(auth, docId, body.default_role));
});
