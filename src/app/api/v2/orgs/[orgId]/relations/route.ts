import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { jsonError, parseJson } from "@/lib/core/http";
import { createRelation, listRelations } from "@/lib/core/relations";
import { relationCreateSchema, relationQuerySchema } from "@/lib/core/schemas";

/** GET /relations?entity_type=task&entity_id=<uuid> — связи одной карточки. */
export const GET = withOrg(async (request, { auth }) => {
  const parsed = relationQuerySchema.safeParse({
    entity_type: request.nextUrl.searchParams.get("entity_type"),
    entity_id: request.nextUrl.searchParams.get("entity_id"),
  });
  if (!parsed.success) return jsonError(422, "entity_type and entity_id are required");
  return NextResponse.json(await listRelations(auth, parsed.data.entity_type, parsed.data.entity_id));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, relationCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createRelation(auth, body), { status: 201 });
});
