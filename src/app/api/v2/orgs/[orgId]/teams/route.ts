import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { teamCreateSchema } from "@/lib/core/schemas";
import { createTeam, listTeams } from "@/lib/core/teams";

export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await listTeams(auth));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, teamCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createTeam(auth, body.name), { status: 201 });
});
