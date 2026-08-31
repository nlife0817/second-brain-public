import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { reorderKbDocuments } from "@/lib/core/kb";
import { kbReorderSchema } from "@/lib/core/schemas";

/**
 * Порядок соседей приходит целиком — как справочник статусов и порядок
 * проектов. Ответ — дерево целиком: панель рисует его одним куском.
 */
export const PUT = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, kbReorderSchema);
  if (invalid) return invalid;
  return NextResponse.json(
    await reorderKbDocuments(auth, {
      parentId: body.parent_id ?? null,
      projectId: body.project_id ?? null,
      order: body.order,
    }),
  );
});
