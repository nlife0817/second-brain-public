import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { createKbDocument, listKbTree } from "@/lib/core/kb";
import { kbCreateSchema } from "@/lib/core/schemas";

/** Дерево целиком: разделы по проектам плюс «Общие». */
export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await listKbTree(auth));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, kbCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(
    await createKbDocument(auth, {
      title: body.title,
      body: body.body,
      kind: body.kind,
      parentId: body.parent_id ?? null,
      projectIds: body.project_ids,
    }),
    { status: 201 },
  );
});
