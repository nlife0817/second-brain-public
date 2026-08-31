import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { createKbDocumentFromTask } from "@/lib/core/kb";
import { kbFromTaskSchema } from "@/lib/core/schemas";

/** Описание задачи → документ базы знаний. */
export const POST = withOrg(async (request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  const [body, invalid] = await parseJson(request, kbFromTaskSchema);
  if (invalid) return invalid;
  return NextResponse.json(
    await createKbDocumentFromTask(auth, taskId, {
      title: body.title,
      parentId: body.parent_id ?? null,
      projectIds: body.project_ids,
      replaceDescription: body.replace_description,
    }),
    { status: 201 },
  );
});
