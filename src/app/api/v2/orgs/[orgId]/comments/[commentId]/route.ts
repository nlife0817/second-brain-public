import { NextResponse } from "next/server";
import { deleteComment, editComment } from "@/lib/core/comments";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { commentCreateSchema } from "@/lib/core/schemas";

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { commentId } = await params;
  if (!isUuid(commentId)) return jsonError(404, "Comment not found");
  const [body, invalid] = await parseJson(request, commentCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await editComment(auth, commentId, body.body));
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { commentId } = await params;
  if (!isUuid(commentId)) return jsonError(404, "Comment not found");
  await deleteComment(auth, commentId);
  return NextResponse.json({ ok: true });
});
