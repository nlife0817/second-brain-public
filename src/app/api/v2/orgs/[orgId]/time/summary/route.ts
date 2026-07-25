import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { jsonError } from "@/lib/core/http";
import { summary } from "@/lib/core/time";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withOrg(async (request, { auth }) => {
  const sp = request.nextUrl.searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const groupBy = (sp.get("group_by") ?? "task") as "user" | "task" | "project";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return jsonError(400, "from/to обязательны (YYYY-MM-DD)");
  if (!["user", "task", "project"].includes(groupBy)) return jsonError(400, "Invalid group_by");
  return NextResponse.json(await summary(auth, { from, to, groupBy }));
});
