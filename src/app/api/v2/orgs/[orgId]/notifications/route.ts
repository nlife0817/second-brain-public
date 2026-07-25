import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import {
  listNotifications,
  markNotificationsRead,
  unreadNotificationCount,
} from "@/lib/core/events";
import { parseJson } from "@/lib/core/http";
import { notificationsReadSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (request, { auth }) => {
  // Бейдж в сайдбаре опрашивается раз в 30 секунд и берёт только счётчик:
  // тянуть ради него сотню записей с подзапросами за названиями сущностей
  // — лишняя работа базы на каждой открытой вкладке.
  if (request.nextUrl.searchParams.get("count") === "1") {
    const unread = await unreadNotificationCount(auth.orgId, auth.user.id);
    return NextResponse.json({ items: [], unread_count: unread });
  }
  const unreadOnly = request.nextUrl.searchParams.get("unread") === "1";
  const [items, unread] = await Promise.all([
    listNotifications(auth.orgId, auth.user.id, { unreadOnly }),
    unreadNotificationCount(auth.orgId, auth.user.id),
  ]);
  return NextResponse.json({ items, unread_count: unread });
});

/** POST — отметить прочитанными: { ids: [...] } или { all: true }. */
export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, notificationsReadSchema);
  if (invalid) return invalid;
  await markNotificationsRead(auth.orgId, auth.user.id, "all" in body ? "all" : body.ids);
  return NextResponse.json({ ok: true });
});
