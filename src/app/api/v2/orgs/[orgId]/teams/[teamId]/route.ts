import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { deleteTeam } from "@/lib/core/teams";

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { teamId } = await params;
  if (!isUuid(teamId)) return jsonError(404, "Team not found");
  await deleteTeam(auth, teamId);
  return NextResponse.json({ ok: true });
});
