import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { deleteRule, updateRule } from "@/lib/core/recurring";
import { recurringPatchSchema } from "@/lib/core/schemas";

/** Сегодня в UTC — та же шкала, в которой хранятся даты расписания. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { ruleId } = await params;
  if (!isUuid(ruleId)) return jsonError(404, "Rule not found");
  const [body, invalid] = await parseJson(request, recurringPatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updateRule(auth, ruleId, body, todayUtc()));
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { ruleId } = await params;
  if (!isUuid(ruleId)) return jsonError(404, "Rule not found");
  await deleteRule(auth, ruleId);
  return NextResponse.json({ ok: true });
});
