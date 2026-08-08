import { NextResponse } from "next/server";
import { addTaskComment, listTaskComments } from "@/lib/core/comments";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { commentCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  return NextResponse.json(await listTaskComments(auth, taskId));
});

export const POST = withOrg(async (request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  const [body, invalid] = await parseJson(request, commentCreateSchema);
  if (invalid) return invalid;
  const comment = await addTaskComment(auth, taskId, body.body, body.parent_id ?? null);
  return NextResponse.json(comment, { status: 201 });
});
