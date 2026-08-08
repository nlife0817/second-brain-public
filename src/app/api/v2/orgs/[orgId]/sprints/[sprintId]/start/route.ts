import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { startSprint } from "@/lib/core/sprints";

export const POST = withOrg(async (_request, { params, auth }) => {
  const { sprintId } = await params;
  if (!isUuid(sprintId)) return jsonError(404, "Sprint not found");
  return NextResponse.json(await startSprint(auth, sprintId));
});
