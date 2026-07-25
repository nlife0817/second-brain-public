import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { getOrgUsage } from "@/lib/core/saas";

export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await getOrgUsage(auth));
});
