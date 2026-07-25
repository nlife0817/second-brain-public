import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { timerStartSchema } from "@/lib/core/schemas";
import { getActiveTimer, startTimer, stopTimer } from "@/lib/core/time";

export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json({ active: await getActiveTimer(auth) });
});

/** POST — старт (предыдущий таймер останавливается автоматически). */
export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, timerStartSchema);
  if (invalid) return invalid;
  return NextResponse.json(await startTimer(auth, body.task_id ?? null, body.note ?? ""));
});

export const DELETE = withOrg(async (_request, { auth }) => {
  return NextResponse.json({ entry: await stopTimer(auth) });
});
