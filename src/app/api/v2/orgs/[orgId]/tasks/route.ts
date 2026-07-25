import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { taskCreateSchema } from "@/lib/core/schemas";
import { createTask, listMyTasks } from "@/lib/core/tasks";

/** GET /tasks?view=my — «Мои задачи» (назначенные мне + личный инбокс). */
export const GET = withOrg(async (request, { auth }) => {
  const includeDone = request.nextUrl.searchParams.get("done") === "1";
  return NextResponse.json(await listMyTasks(auth, { includeDone }));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, taskCreateSchema);
  if (invalid) return invalid;
  const task = await createTask(auth, body);
  return NextResponse.json(task, { status: 201 });
});
