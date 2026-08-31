import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { deleteKbDocument, getKbDocument, updateKbDocument } from "@/lib/core/kb";
import { kbPatchSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  return NextResponse.json(await getKbDocument(auth, docId));
});

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  const [body, invalid] = await parseJson(request, kbPatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updateKbDocument(auth, docId, body));
});

/** Удаление мягкое: документ уезжает в корзину вместе с вложенными. */
export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  await deleteKbDocument(auth, docId);
  return new NextResponse(null, { status: 204 });
});
