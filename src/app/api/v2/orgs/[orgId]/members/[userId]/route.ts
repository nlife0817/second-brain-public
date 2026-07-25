import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { jsonError, parseJson } from "@/lib/core/http";
import {
  countOwners,
  getMembershipRole,
  removeMember,
  updateMemberRole,
} from "@/lib/core/identity";
import { assertOrg } from "@/lib/core/policy";
import { memberPatchSchema } from "@/lib/core/schemas";

export const PATCH = withOrg(async (request, { params, auth }) => {
  assertOrg(auth, "org.members.manage");
  const { userId } = await params;
  const [body, invalid] = await parseJson(request, memberPatchSchema);
  if (invalid) return invalid;

  const currentRole = await getMembershipRole(auth.orgId, userId);
  if (!currentRole) return jsonError(404, "Member not found");

  // Владение раздаёт и забирает только owner.
  if ((body.role === "owner" || currentRole === "owner") && auth.orgRole !== "owner") {
    return jsonError(403, "Only an owner can change ownership");
  }
  // Последний owner неприкосновенен.
  if (currentRole === "owner" && body.role !== "owner" && (await countOwners(auth.orgId)) <= 1) {
    return jsonError(409, "Organization must keep at least one owner");
  }

  await updateMemberRole(auth.orgId, userId, body.role);
  return NextResponse.json({ org_id: auth.orgId, user_id: userId, role: body.role });
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { userId } = await params;
  const isSelf = userId === auth.user.id;
  // Выйти из организации можно самому; чужих удаляет только org.members.manage.
  if (!isSelf) assertOrg(auth, "org.members.manage");

  const currentRole = await getMembershipRole(auth.orgId, userId);
  if (!currentRole) return jsonError(404, "Member not found");

  if (currentRole === "owner") {
    if (!isSelf && auth.orgRole !== "owner") {
      return jsonError(403, "Only an owner can remove an owner");
    }
    if ((await countOwners(auth.orgId)) <= 1) {
      return jsonError(409, "Organization must keep at least one owner");
    }
  }

  await removeMember(auth.orgId, userId);
  return NextResponse.json({ ok: true });
});
