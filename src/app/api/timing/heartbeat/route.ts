import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { recordHeartbeat } from "@/lib/timing-db";

export const POST = withAuth(async (req, _ctx, user) => {
  let body: { last_active_at?: unknown } = {};
  try {
    if (req.headers.get("content-length") !== "0") body = await req.json();
  } catch {
    body = {};
  }

  let lastActiveAt: Date | undefined;
  if (typeof body.last_active_at === "string") {
    const parsed = new Date(body.last_active_at);
    if (!isNaN(parsed.getTime())) lastActiveAt = parsed;
  }

  const now = new Date();
  const updated = await recordHeartbeat({
    userEmail: user.email,
    lastActiveAt,
    now,
  });

  if (!updated) {
    return NextResponse.json(
      { active: false, server_now: now.toISOString() },
      { status: 200 },
    );
  }

  return NextResponse.json({
    active: true,
    entry: updated,
    server_now: now.toISOString(),
  });
});
