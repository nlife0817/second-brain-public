import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { listOrgAudit } from "@/lib/core/saas";

export const GET = withOrg(async (request, { auth }) => {
  const before = Number(request.nextUrl.searchParams.get("before"));
  return NextResponse.json(
    await listOrgAudit(auth, { before: Number.isFinite(before) && before > 0 ? before : undefined }),
  );
});
