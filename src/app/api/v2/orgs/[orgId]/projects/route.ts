import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { createProject, listProjects } from "@/lib/core/projects";
import { projectCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (request, { auth }) => {
  const archived = request.nextUrl.searchParams.get("archived") === "1";
  return NextResponse.json(await listProjects(auth, { archived }));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, projectCreateSchema);
  if (invalid) return invalid;
  const project = await createProject(auth, body);
  return NextResponse.json(project, { status: 201 });
});
