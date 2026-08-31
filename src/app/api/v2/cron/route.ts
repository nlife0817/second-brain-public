// Фоновый обработчик ядра v2. Вызывается pg_cron через pg_net с Bearer CRON_SECRET
// (путь исключён из proxy — см. config.matcher в src/proxy.ts).
//
// Делает четыре вещи:
//   1) рассылает неотправленные core.notifications — push и в телеграм;
//   2) материализует повторяющиеся задачи, которым подошёл срок;
//   3) закрывает забытые таймеры (> лимита часов);
//   4) обновляет подключённые внешние календари.

import { NextRequest, NextResponse } from "next/server";
import { purgeOrphanAttachments } from "@/lib/core/attachments";
import { syncDueCalendars } from "@/lib/core/calendars";
import { purgeEmptyKbDocuments } from "@/lib/core/kb";
import { dispatchPendingNotifications } from "@/lib/core/push";
import { materializeDueRules } from "@/lib/core/recurring";
import { purgeOldReminderMarks, runDueReminders } from "@/lib/core/reminders";
import { deliverWebhooks } from "@/lib/core/saas";
import { purgeExpiredTelegramCodes } from "@/lib/core/telegram";
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
  // Напоминания идут до рассылки: созданные ими уведомления уедут этим же
  // тиком, а не будут ждать следующего.
  const reminders = await runDueReminders().catch((e) => ({ error: String(e) }));

  const [push, recurring, timers, webhooks, attachments, emptyDocs, calendars] = await Promise.all([
    dispatchPendingNotifications().catch((e) => ({ error: String(e) })),
    materializeDueRules(today).catch((e) => ({ error: String(e) })),
    closeStaleTimers().catch((e) => ({ error: String(e) })),
    deliverWebhooks().catch((e) => ({ error: String(e) })),
    // Байты вложений лежат в самой БД и попадают в каждый бэкап, поэтому файл,
    // выброшенный из описания, нельзя оставлять в таблице навсегда.
    purgeOrphanAttachments().catch((e) => ({ error: String(e) })),
    // Документ заводится одним нажатием, и передумать — обычное дело. Вкладку с
    // такой пустышкой обычно закрывают, не дождавшись уборки при уходе, поэтому
    // фон подбирает их сам — через сутки, чтобы не унести открытый в соседней
    // вкладке и ещё не заполненный.
    purgeEmptyKbDocuments().catch((e) => ({ error: String(e) })),
    // Внешние календари: сбой одного подключения садится в его sync_error и
    // остальных не задевает (см. syncAccount), поэтому здесь ловится только
    // отказ самого шага.
    syncDueCalendars(today).catch((e) => ({ error: String(e) })),
  ]);
  // Отметки старше месяца чистим редко и молча — ошибка тут не повод портить ответ.
  const purged = await purgeOldReminderMarks().catch(() => 0);
  // То же для отработавших кодов привязки телеграма: их срок жизни — минуты.
  const telegramCodes = await purgeExpiredTelegramCodes().catch(() => 0);
  return NextResponse.json({
    reminders,
    push,
    recurring,
    timers,
    webhooks,
    purged,
    telegramCodes,
    attachments,
    emptyDocs,
    calendars,
  });
}

export const GET = POST;
