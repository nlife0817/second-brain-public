import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { timeEntryPatchSchema } from "@/lib/core/schemas";
import { deleteEntry, updateEntry } from "@/lib/core/time";

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { entryId } = await params;
  if (!isUuid(entryId)) return jsonError(404, "Entry not found");
  const [body, invalid] = await parseJson(request, timeEntryPatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updateEntry(auth, entryId, body));
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { entryId } = await params;
  if (!isUuid(entryId)) return jsonError(404, "Entry not found");
  await deleteEntry(auth, entryId);
  return NextResponse.json({ ok: true });
});
