import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { deleteDocComment, editDocComment } from "@/lib/core/doc-comments";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { docCommentBodySchema } from "@/lib/core/schemas";

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { commentId } = await params;
  if (!isUuid(commentId)) return jsonError(404, "Комментарий не найден");
  const [body, invalid] = await parseJson(request, docCommentBodySchema);
  if (invalid) return invalid;
  return NextResponse.json(await editDocComment(auth, commentId, body.body));
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { commentId } = await params;
  if (!isUuid(commentId)) return jsonError(404, "Комментарий не найден");
  await deleteDocComment(auth, commentId);
  return NextResponse.json({ ok: true });
});
