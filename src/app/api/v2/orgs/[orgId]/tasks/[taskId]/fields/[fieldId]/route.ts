import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { setTaskFieldValue } from "@/lib/core/fields";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { fieldValueSchema } from "@/lib/core/schemas";

/** PUT value=null очищает значение. */
export const PUT = withOrg(async (request, { params, auth }) => {
  const { taskId, fieldId } = await params;
  if (!isUuid(taskId) || !isUuid(fieldId)) return jsonError(404, "Not found");
  const [body, invalid] = await parseJson(request, fieldValueSchema);
  if (invalid) return invalid;
  await setTaskFieldValue(auth, taskId, fieldId, body.value ?? null);
  return NextResponse.json({ ok: true });
});
