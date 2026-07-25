import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { revokeInvitation } from "@/lib/core/identity";
import { assertOrg } from "@/lib/core/policy";

export const DELETE = withOrg(async (_request, { params, auth }) => {
  assertOrg(auth, "org.invite");
  const { invitationId } = await params;
  await revokeInvitation(auth.orgId, invitationId);
  return NextResponse.json({ ok: true });
});
