import { NextResponse } from "next/server";
import { withUser } from "@/lib/core/context";
import { listUserOrgs } from "@/lib/core/identity";

export const GET = withUser(async (_request, user) => {
  const orgs = await listUserOrgs(user.id);
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url,
    },
    orgs,
  });
});
