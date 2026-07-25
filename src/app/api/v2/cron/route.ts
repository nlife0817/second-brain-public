// Фоновый обработчик ядра v2. Вызывается pg_cron через pg_net с Bearer CRON_SECRET
// (путь исключён из proxy — см. config.matcher в src/proxy.ts).
//
// Делает три вещи:
//   1) рассылает push по неотправленным core.notifications;
//   2) материализует повторяющиеся задачи, которым подошёл срок;
//   3) закрывает забытые таймеры (> лимита часов).

import { NextRequest, NextResponse } from "next/server";
import { dispatchPendingPush } from "@/lib/core/push";
import { materializeDueRules } from "@/lib/core/recurring";
import { deliverWebhooks } from "@/lib/core/saas";
import { closeStaleTimers } from "@/lib/core/time";

export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[v2/cron] CRON_SECRET не задан — запрос отклонён");
    return false;
  }
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const today = new Date().toISOString().slice(0, 10);
  // Шаги независимы: сбой одного не должен обнулять остальные и весь тик.
  // Push здесь — страховка: основную доставку делает after() в withOrg/withUser
  // сразу после мутации; cron добирает то, что не дошло (см. lib/core/push.ts).
  const [push, recurring, timers, webhooks] = await Promise.all([
    dispatchPendingPush().catch((e) => ({ error: String(e) })),
    materializeDueRules(today).catch((e) => ({ error: String(e) })),
    closeStaleTimers().catch((e) => ({ error: String(e) })),
    deliverWebhooks().catch((e) => ({ error: String(e) })),
  ]);
  return NextResponse.json({ push, recurring, timers, webhooks });
}

export const GET = POST;
