// Push-подписка пользователя (устройство ↔ core.users).

import { NextRequest, NextResponse } from "next/server";
import { prepare } from "@/lib/sql";
import { withUser } from "@/lib/core/context";
import { jsonError, parseJson } from "@/lib/core/http";
import { pushSubscribeSchema } from "@/lib/core/schemas";

export const POST = withUser(async (request: NextRequest, user) => {
  const [body, invalid] = await parseJson(request, pushSubscribeSchema);
  if (invalid) return invalid;
  const userAgent = request.headers.get("user-agent");
  // Endpoint уникален для пары браузер+SW: перевыпуск подписки или вход под
  // другим пользователем на том же устройстве должны перепривязывать строку.
  await prepare(
    `INSERT INTO core.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent,
       updated_at = now()`,
  ).run(user.id, body.endpoint, body.keys.p256dh, body.keys.auth, userAgent);
  return NextResponse.json({ ok: true });
});

export const DELETE = withUser(async (request: NextRequest, user) => {
  const endpoint = request.nextUrl.searchParams.get("endpoint");
  if (!endpoint) return jsonError(400, "endpoint query param required");
  await prepare(`DELETE FROM core.push_subscriptions WHERE user_id = ? AND endpoint = ?`).run(
    user.id,
    endpoint,
  );
  return NextResponse.json({ ok: true });
});
