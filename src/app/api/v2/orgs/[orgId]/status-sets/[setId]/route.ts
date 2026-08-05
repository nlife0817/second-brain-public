import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { deleteStatusSet, updateStatusSet } from "@/lib/core/orgmeta";
import { statusSetPatchSchema } from "@/lib/core/schemas";

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { setId } = await params;
  if (!isUuid(setId)) return jsonError(404, "Status set not found");
  const [body, invalid] = await parseJson(request, statusSetPatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updateStatusSet(auth, setId, body));
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { setId } = await params;
  if (!isUuid(setId)) return jsonError(404, "Status set not found");
  await deleteStatusSet(auth, setId);
  return NextResponse.json({ ok: true });
});
