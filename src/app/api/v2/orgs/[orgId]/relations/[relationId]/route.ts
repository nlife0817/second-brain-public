import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { deleteRelation } from "@/lib/core/relations";

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { relationId } = await params;
  if (!isUuid(relationId)) return jsonError(404, "Relation not found");
  await deleteRelation(auth, relationId);
  return NextResponse.json({ ok: true });
});
