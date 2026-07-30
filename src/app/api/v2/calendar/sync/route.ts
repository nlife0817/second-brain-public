// Обновление внешних календарей по кнопке. Тик cron делает то же раз в
// полчаса — здесь путь для того, кто не хочет ждать.
//
// Отказ одного подключения не роняет остальные: причина садится в его
// `sync_error` и возвращается в отчёте (см. `syncAccount`).

import { NextResponse } from "next/server";
import { listCalendarAccounts, syncUserCalendars } from "@/lib/core/calendars";
import { withUser } from "@/lib/core/context";
import { todayIso } from "@/lib/core/views";

export const POST = withUser(async (_request, user) => {
  const report = await syncUserCalendars(user.id, todayIso());
  return NextResponse.json({ report, accounts: await listCalendarAccounts(user.id) });
});
