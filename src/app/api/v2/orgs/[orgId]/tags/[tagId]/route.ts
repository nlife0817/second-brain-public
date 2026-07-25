import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { deleteTag, updateTag } from "@/lib/core/orgmeta";
import { tagPatchSchema } from "@/lib/core/schemas";

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { tagId } = await params;
  if (!isUuid(tagId)) return jsonError(404, "Tag not found");
  const [body, invalid] = await parseJson(request, tagPatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updateTag(auth, tagId, body));
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { tagId } = await params;
  if (!isUuid(tagId)) return jsonError(404, "Tag not found");
  await deleteTag(auth, tagId);
  return NextResponse.json({ ok: true });
});
