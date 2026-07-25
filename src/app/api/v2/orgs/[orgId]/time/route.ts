import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { manualTimeEntrySchema } from "@/lib/core/schemas";
import { addManualEntry, getActiveTimer, listEntries } from "@/lib/core/time";

export const GET = withOrg(async (request, { auth }) => {
  const sp = request.nextUrl.searchParams;
  const userId = sp.get("user_id") ?? undefined;
  const taskId = sp.get("task_id") ?? undefined;
  if (userId && !isUuid(userId)) return jsonError(400, "Invalid user_id");
  if (taskId && !isUuid(taskId)) return jsonError(400, "Invalid task_id");
  const [entries, active] = await Promise.all([
    listEntries(auth, {
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      userId,
      taskId,
    }),
    getActiveTimer(auth),
  ]);
  return NextResponse.json({ entries, active });
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, manualTimeEntrySchema);
  if (invalid) return invalid;
  return NextResponse.json(await addManualEntry(auth, body), { status: 201 });
});
