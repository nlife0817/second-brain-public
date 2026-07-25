import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { deleteStatus, updateStatus } from "@/lib/core/orgmeta";
import { statusPatchSchema } from "@/lib/core/schemas";

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { statusId } = await params;
  if (!isUuid(statusId)) return jsonError(404, "Status not found");
  const [body, invalid] = await parseJson(request, statusPatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updateStatus(auth, statusId, body));
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { statusId } = await params;
  if (!isUuid(statusId)) return jsonError(404, "Status not found");
  await deleteStatus(auth, statusId);
  return NextResponse.json({ ok: true });
});
