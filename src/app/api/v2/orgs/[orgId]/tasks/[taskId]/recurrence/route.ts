import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { clearTaskRule, getTaskRule, setTaskRule } from "@/lib/core/recurring";
import { taskRecurrenceSchema } from "@/lib/core/schemas";
import { requireTaskAccess } from "@/lib/core/tasks";

/** Сегодня в UTC — та же шкала, в которой хранятся даты расписания. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export const GET = withOrg(async (_request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  await requireTaskAccess(auth, taskId, "view");
  return NextResponse.json(await getTaskRule(taskId, auth.orgId));
});

export const PUT = withOrg(async (request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  const [body, invalid] = await parseJson(request, taskRecurrenceSchema);
  if (invalid) return invalid;
  const today = todayUtc();
  return NextResponse.json(
    await setTaskRule(
      auth,
      taskId,
      {
        freq: body.freq,
        interval: body.interval,
        byweekday: body.freq === "weekly" ? (body.byweekday ?? null) : null,
        bymonthday: body.freq === "monthly" ? (body.bymonthday ?? null) : null,
        // Без явной даты расписание стартует сегодня: включать повтор задним
        // числом никто не просит, а «пропущенные» дни всё равно не догоняются.
        start_date: body.start_date ?? today,
        until_date: body.until_date ?? null,
      },
      today,
    ),
  );
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  await clearTaskRule(auth, taskId);
  return NextResponse.json({ ok: true });
});
