import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { createDocThread, listDocComments, replyToDocThread } from "@/lib/core/doc-comments";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { docThreadCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  return NextResponse.json(await listDocComments(auth, { kind: "document", documentId: docId }));
});

/** Новый тред либо ответ в существующий — по `?thread=<id>`, как у задачи. */
export const POST = withOrg(async (request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  const [body, invalid] = await parseJson(request, docThreadCreateSchema);
  if (invalid) return invalid;

  const owner = { kind: "document" as const, documentId: docId };
  const threadId = new URL(request.url).searchParams.get("thread");
  if (threadId) {
    if (!isUuid(threadId)) return jsonError(404, "Обсуждение не найдено");
    return NextResponse.json(await replyToDocThread(auth, owner, threadId, body.body), {
      status: 201,
    });
  }
  return NextResponse.json(await createDocThread(auth, owner, body), { status: 201 });
});
