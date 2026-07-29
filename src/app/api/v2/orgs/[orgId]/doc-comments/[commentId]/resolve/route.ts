import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { setDocThreadResolved } from "@/lib/core/doc-comments";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { docThreadResolveSchema } from "@/lib/core/schemas";

/** Закрыть (`{resolved: true}`) или переоткрыть тред обсуждения описания. */
export const POST = withOrg(async (request, { params, auth }) => {
  const { commentId } = await params;
  if (!isUuid(commentId)) return jsonError(404, "Обсуждение не найдено");
  const [body, invalid] = await parseJson(request, docThreadResolveSchema);
  if (invalid) return invalid;
  return NextResponse.json(await setDocThreadResolved(auth, commentId, body.resolved));
});
