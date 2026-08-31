import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { moveKbDocument } from "@/lib/core/kb";
import { kbMoveSchema } from "@/lib/core/schemas";

/** Перенос по дереву. Ответ — дерево целиком, как у перестановки. */
export const PUT = withOrg(async (request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  const [body, invalid] = await parseJson(request, kbMoveSchema);
  if (invalid) return invalid;
  return NextResponse.json(
    await moveKbDocument(auth, docId, {
      parentId: body.parent_id,
      projectId: body.project_id ?? null,
      fromProjectId: body.from_project_id ?? null,
      order: body.order,
    }),
  );
});
