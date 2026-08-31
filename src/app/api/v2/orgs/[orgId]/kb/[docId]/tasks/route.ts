import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { linkKbTask, listDocumentTasks, unlinkKbTask } from "@/lib/core/kb";
import { kbTaskLinkSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  return NextResponse.json(await listDocumentTasks(auth, docId));
});

export const POST = withOrg(async (request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  const [body, invalid] = await parseJson(request, kbTaskLinkSchema);
  if (invalid) return invalid;
  return NextResponse.json(await linkKbTask(auth, docId, body.task_id), { status: 201 });
});

/** Снятие связи — задача приходит параметром: тела у DELETE может не быть. */
export const DELETE = withOrg(async (request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  const taskId = new URL(request.url).searchParams.get("task");
  if (!isUuid(taskId)) return jsonError(404, "Задача не найдена");
  return NextResponse.json(await unlinkKbTask(auth, docId, taskId));
});
