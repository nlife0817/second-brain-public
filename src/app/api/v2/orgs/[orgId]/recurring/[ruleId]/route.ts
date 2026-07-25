import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { deleteRule } from "@/lib/core/recurring";

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { ruleId } = await params;
  if (!isUuid(ruleId)) return jsonError(404, "Rule not found");
  await deleteRule(auth, ruleId);
  return NextResponse.json({ ok: true });
});
