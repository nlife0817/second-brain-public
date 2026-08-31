import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { listTaskDocuments } from "@/lib/core/kb";

/** Документы базы знаний, привязанные к задаче: блок «Документы» в карточке. */
export const GET = withOrg(async (_request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  return NextResponse.json(await listTaskDocuments(auth, taskId));
});
