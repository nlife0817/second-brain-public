// Подключённые внешние календари пользователя.
//
// Организации здесь нет: подключение принадлежит человеку, а не тенанту
// (миграция 0046). Секрет подключения наружу не отдаётся — в выдаче только
// подпись и список календарей.

import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/lib/core/context";
import { connectIcsAccount, listCalendarAccounts, syncAccount } from "@/lib/core/calendars";
import { parseJson } from "@/lib/core/http";
import { todayIso } from "@/lib/core/views";

export const GET = withUser(async (_request, user) => {
  return NextResponse.json(await listCalendarAccounts(user.id));
});

const icsSchema = z.object({
  url: z.string().trim().min(8).max(2000),
});

/**
 * Подписка на ICS-ссылку. Первая синхронизация идёт сразу: подключение, которое
 * до следующего тика cron выглядит пустым, читается как неработающее.
 */
export const POST = withUser(async (request, user) => {
  const [body, error] = await parseJson(request, icsSchema);
  if (error) return error;

  const accountId = await connectIcsAccount(user.id, body.url);
  const report = await syncAccount(accountId, todayIso());
  const accounts = await listCalendarAccounts(user.id);
  return NextResponse.json({ accounts, report }, { status: 201 });
});
