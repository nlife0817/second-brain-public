import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { createInvitation, listInvitations } from "@/lib/core/identity";
import { assertOrg } from "@/lib/core/policy";
import { invitationCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { auth }) => {
  assertOrg(auth, "org.invite");
  return NextResponse.json(await listInvitations(auth.orgId));
});

export const POST = withOrg(async (request, { auth }) => {
  assertOrg(auth, "org.invite");
  const [body, invalid] = await parseJson(request, invitationCreateSchema);
  if (invalid) return invalid;

  const { invitation, token } = await createInvitation({
    orgId: auth.orgId,
    email: body.email,
    orgRole: body.org_role,
    projectGrants: body.project_grants,
    invitedBy: auth.user.id,
  });

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  return NextResponse.json(
    { invitation, invite_url: `${origin}/invite/${token}` },
    { status: 201 },
  );
});
