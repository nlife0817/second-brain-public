import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { purgeKbDocument } from "@/lib/core/kb";

/** Окончательное удаление из корзины: вложения и версии уходят каскадом. */
export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  await purgeKbDocument(auth, docId);
  return new NextResponse(null, { status: 204 });
});
