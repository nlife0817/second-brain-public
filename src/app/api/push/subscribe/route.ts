import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { prepare } from "@/lib/sql";
import { getAuthUser } from "@/lib/auth";

type SubscribeBody = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await req.json()) as SubscribeBody;
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }
    const userAgent = req.headers.get("user-agent") ?? null;
    const now = new Date().toISOString();
    const id = uuid();
    await prepare(`
      INSERT INTO push_subscriptions (id, user_email, endpoint, p256dh, auth, user_agent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET
        user_email = EXCLUDED.user_email,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent,
        updated_at = EXCLUDED.updated_at
    `).run(id, user.email, body.endpoint, body.keys.p256dh, body.keys.auth, userAgent, now, now);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[push/subscribe] error:", e);
    return NextResponse.json({ error: "Failed to subscribe" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const endpoint = req.nextUrl.searchParams.get("endpoint");
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint query param required" }, { status: 400 });
  }
  await prepare("DELETE FROM push_subscriptions WHERE user_email = ? AND endpoint = ?")
    .run(user.email, endpoint);
  return NextResponse.json({ ok: true });
}
