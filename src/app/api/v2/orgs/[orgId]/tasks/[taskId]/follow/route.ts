import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { setFollowing } from "@/lib/core/tasks";

export const POST = withOrg(async (_request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  await setFollowing(auth, taskId, true);
  return NextResponse.json({ ok: true });
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  await setFollowing(auth, taskId, false);
  return NextResponse.json({ ok: true });
});
