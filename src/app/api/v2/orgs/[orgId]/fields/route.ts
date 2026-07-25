import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { createField, listFields } from "@/lib/core/fields";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { fieldCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (request, { auth }) => {
  const projectId = request.nextUrl.searchParams.get("project_id") ?? undefined;
  if (projectId && !isUuid(projectId)) return jsonError(404, "Project not found");
  return NextResponse.json(await listFields(auth, projectId));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, fieldCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createField(auth, body), { status: 201 });
});
