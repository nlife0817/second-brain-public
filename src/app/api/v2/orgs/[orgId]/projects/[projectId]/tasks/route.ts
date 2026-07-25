import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { listProjectTasks } from "@/lib/core/tasks";

export const GET = withOrg(async (request, { params, auth }) => {
  const { projectId } = await params;
  if (!isUuid(projectId)) return jsonError(404, "Project not found");
  const includeDone = request.nextUrl.searchParams.get("done") === "1";
  return NextResponse.json(await listProjectTasks(auth, projectId, { includeDone }));
});
