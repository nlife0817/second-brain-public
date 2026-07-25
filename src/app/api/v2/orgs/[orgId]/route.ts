import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { jsonError, parseJson } from "@/lib/core/http";
import { getOrganization, updateOrganization } from "@/lib/core/identity";
import { assertOrg } from "@/lib/core/policy";
import { orgPatchSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { auth }) => {
  const org = await getOrganization(auth.orgId);
  if (!org) return jsonError(404, "Not found");
  return NextResponse.json({ ...org, my_role: auth.orgRole });
});

export const PATCH = withOrg(async (request, { auth }) => {
  assertOrg(auth, "org.update");
  const [body, invalid] = await parseJson(request, orgPatchSchema);
  if (invalid) return invalid;
  const org = await updateOrganization(auth.orgId, body);
  return NextResponse.json({ ...org, my_role: auth.orgRole });
});
