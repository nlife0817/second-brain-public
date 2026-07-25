import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { revokeInvitation } from "@/lib/core/identity";
import { assertOrg } from "@/lib/core/policy";

export const DELETE = withOrg(async (_request, { params, auth }) => {
  assertOrg(auth, "org.invite");
  const { invitationId } = await params;
  if (!isUuid(invitationId)) return jsonError(404, "Invitation not found");
  await revokeInvitation(auth.orgId, invitationId);
  return NextResponse.json({ ok: true });
});
