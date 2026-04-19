import { NextResponse } from "next/server";
import { prepare } from "@/lib/sql";
import { getAuthUser } from "@/lib/auth";

type SubRow = { id: string; endpoint: string; user_agent: string | null; created_at: string; updated_at: string };
type LogRow = { type: string; target_id: string; sent_at: string };
type TzRow = { timezone: string };

function endpointOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return "(invalid endpoint)";
  }
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tz = await prepare<TzRow>("SELECT timezone FROM users WHERE email = ?").get(user.email);
  const subs = await prepare<SubRow>(
    "SELECT id, endpoint, user_agent, created_at, updated_at FROM push_subscriptions WHERE user_email = ? ORDER BY created_at DESC"
  ).all(user.email);
  const log = await prepare<LogRow>(
    "SELECT type, target_id, sent_at FROM notifications_log WHERE user_email = ? ORDER BY sent_at DESC LIMIT 10"
  ).all(user.email);

  const vapidPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const cronSecretConfigured = !!process.env.CRON_SECRET;

  return NextResponse.json({
    user: { email: user.email, role: user.role, timezone: tz?.timezone ?? null },
    server_time_utc: new Date().toISOString(),
    vapid_public_key_prefix: vapidPub ? vapidPub.slice(0, 12) + "…" : null,
    vapid_public_key_length: vapidPub.length,
    cron_secret_configured: cronSecretConfigured,
    subscriptions: subs.map((s) => ({
      id: s.id,
      origin: endpointOrigin(s.endpoint),
      user_agent: s.user_agent,
      created_at: s.created_at,
      updated_at: s.updated_at,
    })),
    subscriptions_count: subs.length,
    recent_log: log,
  });
}
