import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { removeProjectMember, upsertProjectMember } from "@/lib/core/projects";
import { z } from "zod";

const rolePatchSchema = z.object({
  role: z.enum(["admin", "editor", "commenter", "viewer"]),
});

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { projectId, userId } = await params;
  if (!isUuid(projectId) || !isUuid(userId)) return jsonError(404, "Not found");
  const [body, invalid] = await parseJson(request, rolePatchSchema);
  if (invalid) return invalid;
  await upsertProjectMember(auth, projectId, userId, body.role);
  return NextResponse.json({ ok: true });
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { projectId, userId } = await params;
  if (!isUuid(projectId) || !isUuid(userId)) return jsonError(404, "Not found");
  await removeProjectMember(auth, projectId, userId);
  return NextResponse.json({ ok: true });
});
