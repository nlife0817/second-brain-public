import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { search } from "@/lib/core/search";

export const GET = withOrg(async (request, { auth }) => {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json(await search(auth, q));
});
