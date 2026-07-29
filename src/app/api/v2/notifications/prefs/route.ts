// Настройки уведомлений по типам событий. Пользовательские, вне организации:
// типы событий общие, и переключать их отдельно в каждой организации незачем.

import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/core/context";
import { jsonError, parseJson } from "@/lib/core/http";
import { NOTIFICATION_KINDS } from "@/lib/core/notification-kinds";
import { getNotificationPrefs, isKnownKind, setNotificationPref } from "@/lib/core/notification-prefs";
import { notificationPrefSchema } from "@/lib/core/schemas";

export const GET = withUser(async (_request: NextRequest, user) => {
  const prefs = await getNotificationPrefs(user.id);
  return NextResponse.json({ kinds: NOTIFICATION_KINDS, prefs });
});

export const PUT = withUser(async (request: NextRequest, user) => {
  const [body, invalid] = await parseJson(request, notificationPrefSchema);
  if (invalid) return invalid;
  // Неизвестный kind — не 400 «на всякий случай», а защита от мусора в
  // таблице: настройка типа, которого не существует, никогда не сработает.
  if (!isKnownKind(body.kind)) return jsonError(400, "Unknown notification kind");
  await setNotificationPref(user.id, body.kind, { inbox: body.inbox, push: body.push });
  const prefs = await getNotificationPrefs(user.id);
  return NextResponse.json({ prefs });
});
