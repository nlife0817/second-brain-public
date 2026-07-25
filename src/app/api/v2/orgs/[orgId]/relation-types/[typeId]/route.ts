import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { deleteRelationType, updateRelationType } from "@/lib/core/relations";
import { relationTypePatchSchema } from "@/lib/core/schemas";

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { typeId } = await params;
  if (!isUuid(typeId)) return jsonError(404, "Relation type not found");
  const [body, invalid] = await parseJson(request, relationTypePatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updateRelationType(auth, typeId, body));
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { typeId } = await params;
  if (!isUuid(typeId)) return jsonError(404, "Relation type not found");
  await deleteRelationType(auth, typeId);
  return NextResponse.json({ ok: true });
});
