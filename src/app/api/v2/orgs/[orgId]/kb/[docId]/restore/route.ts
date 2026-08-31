import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { listKbTree, restoreKbDocument } from "@/lib/core/kb";

export const POST = withOrg(async (_request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  await restoreKbDocument(auth, docId);
  return NextResponse.json(await listKbTree(auth));
});
