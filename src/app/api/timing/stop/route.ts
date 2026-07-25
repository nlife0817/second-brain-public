import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { stopActiveTimer } from "@/lib/timing-db";

export const POST = withAuth(async (req, _ctx, user) => {
  let body: { note?: unknown } = {};
  try {
    if (req.headers.get("content-length") !== "0") body = await req.json();
  } catch {
    body = {};
  }

  const note = typeof body.note === "string" ? body.note : undefined;

  const closed = await stopActiveTimer({
    userEmail: user.email,
    source: "manual",
    note,
  });

  if (!closed) {
    return NextResponse.json({ error: "no active timer" }, { status: 404 });
  }
  return NextResponse.json({ entry: closed, server_now: new Date().toISOString() });
});
