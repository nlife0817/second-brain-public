import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { createInvitation, listInvitations } from "@/lib/core/identity";
import { assertOrg } from "@/lib/core/policy";
import { requireProject } from "@/lib/core/projects";
import { assertWithinLimit } from "@/lib/core/saas";
import { invitationCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { auth }) => {
  assertOrg(auth, "org.invite");
  return NextResponse.json(await listInvitations(auth.orgId));
});

export const POST = withOrg(async (request, { auth }) => {
  assertOrg(auth, "org.invite");
  const [body, invalid] = await parseJson(request, invitationCreateSchema);
  if (invalid) return invalid;

  // Раздать доступ можно только к тому, чем управляешь сам: иначе админ,
  // не входящий в приватный проект, впустил бы туда гостя по его id.
  for (const grant of body.project_grants) {
    await requireProject(auth, grant.project_id, "project.members.manage");
  }

  // Приглашение — это будущее место в организации, поэтому лимит проверяем здесь.
  await assertWithinLimit(auth, body.org_role === "guest" ? "guests" : "members");

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
