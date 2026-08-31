import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { createDocThread, listDocComments, replyToDocThread } from "@/lib/core/doc-comments";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { docThreadCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  return NextResponse.json(await listDocComments(auth, { kind: "task", taskId }));
});

/**
 * Новый тред либо ответ в существующий — по `?thread=<id>`. Ответ всегда
 * возвращает тред целиком: панель комментариев рисует его одним куском, и
 * склеивать сообщение с остальными на клиенте незачем.
 */
export const POST = withOrg(async (request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  const [body, invalid] = await parseJson(request, docThreadCreateSchema);
  if (invalid) return invalid;

  const threadId = new URL(request.url).searchParams.get("thread");
  if (threadId) {
    if (!isUuid(threadId)) return jsonError(404, "Обсуждение не найдено");
    return NextResponse.json(await replyToDocThread(auth, { kind: "task", taskId }, threadId, body.body), {
      status: 201,
    });
  }
  return NextResponse.json(await createDocThread(auth, { kind: "task", taskId }, body), { status: 201 });
});
