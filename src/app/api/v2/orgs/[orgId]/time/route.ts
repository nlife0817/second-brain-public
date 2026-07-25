import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { manualTimeEntrySchema } from "@/lib/core/schemas";
import { addManualEntry, getActiveTimer, listEntries } from "@/lib/core/time";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withOrg(async (request, { auth }) => {
  const sp = request.nextUrl.searchParams;
  const userId = sp.get("user_id") ?? undefined;
  const taskId = sp.get("task_id") ?? undefined;
  const from = sp.get("from") ?? undefined;
  const to = sp.get("to") ?? undefined;
  if (userId && !isUuid(userId)) return jsonError(400, "Invalid user_id");
  if (taskId && !isUuid(taskId)) return jsonError(400, "Invalid task_id");
  // Незаполненное поле даты в UI не должно превращаться в 500 из Postgres.
  if (from && !DATE_RE.test(from)) return jsonError(400, "Invalid from (YYYY-MM-DD)");
  if (to && !DATE_RE.test(to)) return jsonError(400, "Invalid to (YYYY-MM-DD)");
  const [entries, active] = await Promise.all([
    listEntries(auth, { from, to, userId, taskId }),
    getActiveTimer(auth),
  ]);
  return NextResponse.json({ entries, active });
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, manualTimeEntrySchema);
  if (invalid) return invalid;
  return NextResponse.json(await addManualEntry(auth, body), { status: 201 });
});
