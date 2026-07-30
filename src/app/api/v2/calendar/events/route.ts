// События внешних календарей за окно. Только чтение: строки этой таблицы пишет
// одна синхронизация.

import { NextResponse } from "next/server";
import { listCalendarEvents } from "@/lib/core/calendars";
import { withUser } from "@/lib/core/context";
import { jsonError } from "@/lib/core/http";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Предел окна: полотно просит месяц, а не десятилетие. */
const MAX_WINDOW_DAYS = 400;

export const GET = withUser(async (request, user) => {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to || !DAY_RE.test(from) || !DAY_RE.test(to)) {
    return jsonError(400, "from и to обязательны в виде YYYY-MM-DD");
  }
  if (to < from) return jsonError(400, "to раньше from");
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days > MAX_WINDOW_DAYS) return jsonError(400, "Окно слишком широкое");

  return NextResponse.json(await listCalendarEvents(user.id, { from, to }));
});
