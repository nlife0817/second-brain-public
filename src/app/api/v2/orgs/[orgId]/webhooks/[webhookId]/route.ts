import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { deleteWebhook } from "@/lib/core/saas";

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { webhookId } = await params;
  if (!isUuid(webhookId)) return jsonError(404, "Webhook not found");
  await deleteWebhook(auth, webhookId);
  return NextResponse.json({ ok: true });
});
