import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { setKbProjects } from "@/lib/core/kb";
import { kbProjectsSchema } from "@/lib/core/schemas";

/** Привязка корня к проектам. Пустой список делает документ «общим». */
export const PUT = withOrg(async (request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  const [body, invalid] = await parseJson(request, kbProjectsSchema);
  if (invalid) return invalid;
  return NextResponse.json(await setKbProjects(auth, docId, body.project_ids));
});
