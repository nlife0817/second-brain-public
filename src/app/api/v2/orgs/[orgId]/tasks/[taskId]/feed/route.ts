import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { listEntityFeed } from "@/lib/core/events";
import { isUuid, jsonError } from "@/lib/core/http";
import { requireTaskAccess } from "@/lib/core/tasks";

export const GET = withOrg(async (_request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  await requireTaskAccess(auth, taskId, "view");
  return NextResponse.json(await listEntityFeed("task", taskId));
});
