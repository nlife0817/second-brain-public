import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { deleteStage, updateStage } from "@/lib/core/crm";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { stagePatchSchema } from "@/lib/core/schemas";

export const PATCH = withOrg(async (request, { auth, params }) => {
  const { stageId } = await params;
  if (!isUuid(stageId)) return jsonError(404, "Not found");
  const [body, invalid] = await parseJson(request, stagePatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updateStage(auth, stageId, body));
});

export const DELETE = withOrg(async (_request, { auth, params }) => {
  const { stageId } = await params;
  if (!isUuid(stageId)) return jsonError(404, "Not found");
  await deleteStage(auth, stageId);
  return NextResponse.json({ ok: true });
});
