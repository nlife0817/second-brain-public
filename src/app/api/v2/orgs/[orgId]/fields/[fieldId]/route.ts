import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { deleteField, updateField } from "@/lib/core/fields";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { fieldPatchSchema } from "@/lib/core/schemas";

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { fieldId } = await params;
  if (!isUuid(fieldId)) return jsonError(404, "Field not found");
  const [body, invalid] = await parseJson(request, fieldPatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updateField(auth, fieldId, body));
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { fieldId } = await params;
  if (!isUuid(fieldId)) return jsonError(404, "Field not found");
  await deleteField(auth, fieldId);
  return NextResponse.json({ ok: true });
});
