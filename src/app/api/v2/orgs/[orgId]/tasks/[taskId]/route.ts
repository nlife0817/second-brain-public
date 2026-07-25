import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { taskPatchSchema } from "@/lib/core/schemas";
import { deleteTask, getTaskDetail, updateTask } from "@/lib/core/tasks";

export const GET = withOrg(async (_request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  return NextResponse.json(await getTaskDetail(auth, taskId));
});

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  const [body, invalid] = await parseJson(request, taskPatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updateTask(auth, taskId, body));
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  await deleteTask(auth, taskId);
  return NextResponse.json({ ok: true });
});
