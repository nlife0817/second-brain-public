import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { listOrgMembers } from "@/lib/core/identity";
import { assertOrg } from "@/lib/core/policy";

export const GET = withOrg(async (_request, { auth }) => {
  assertOrg(auth, "org.members.view");
  return NextResponse.json(await listOrgMembers(auth.orgId));
});
