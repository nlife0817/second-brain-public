import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { deleteEntry } from "@/lib/core/time";

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { entryId } = await params;
  if (!isUuid(entryId)) return jsonError(404, "Entry not found");
  await deleteEntry(auth, entryId);
  return NextResponse.json({ ok: true });
});
