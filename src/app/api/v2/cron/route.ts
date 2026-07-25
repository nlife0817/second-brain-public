// Фоновый обработчик ядра v2. Вызывается pg_cron через pg_net с Bearer CRON_SECRET
// (путь исключён из proxy — см. config.matcher в src/proxy.ts).
//
// Делает три вещи:
//   1) рассылает push по неотправленным core.notifications;
//   2) материализует повторяющиеся задачи, которым подошёл срок;
//   3) закрывает забытые таймеры (> лимита часов).

import { NextRequest, NextResponse } from "next/server";
import { prepare } from "@/lib/sql";
import { sendPushToEmail } from "@/lib/notifications/push";
import { materializeDueRules } from "@/lib/core/recurring";
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

const KIND_TITLES: Record<string, string> = {
  assigned: "Вам назначили задачу",
  comment: "Новый комментарий",
  status_changed: "Статус изменён",
  completed: "Задача завершена",
  due_changed: "Срок изменён",
  added_to_project: "Вас добавили в проект",
};

type PendingRow = {
  id: string;
  kind: string;
  email: string;
  actor_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_title: string | null;
};

async function dispatchPush(): Promise<{ sent: number; skipped: number }> {
  const pending = await prepare<PendingRow>(
    `SELECT n.id, n.kind, u.email, a.name AS actor_name,
            e.entity_type, e.entity_id::text AS entity_id,
            CASE
              WHEN e.entity_type = 'task' THEN (SELECT t.title FROM core.tasks t WHERE t.id = e.entity_id)
              WHEN e.entity_type = 'project' THEN (SELECT p.name FROM core.projects p WHERE p.id = e.entity_id)
            END AS entity_title
     FROM core.notifications n
     JOIN core.users u ON u.id = n.user_id
     LEFT JOIN core.events e ON e.id = n.event_id
     LEFT JOIN core.users a ON a.id = e.actor_id
     WHERE n.dispatched_at IS NULL
       AND n.read_at IS NULL
       AND n.created_at > now() - interval '2 days'
     ORDER BY n.created_at
     LIMIT 100`,
  ).all();

  let sent = 0;
  let skipped = 0;
  for (const row of pending) {
    const title = KIND_TITLES[row.kind] ?? "Обновление";
    const body = [row.actor_name, row.entity_title && `«${row.entity_title}»`]
      .filter(Boolean)
      .join(" · ");
    try {
      const res = await sendPushToEmail(row.email, {
        title,
        body: body || "Открыть задачу",
        url: row.entity_type === "task" && row.entity_id ? `/v2/my?task=${row.entity_id}` : "/v2/inbox",
        tag: `v2-${row.id}`,
      });
      if (res.sent > 0) sent++;
      else skipped++;
    } catch {
      skipped++;
    }
    // Отметка ставится в любом случае: повторные попытки только копили бы очередь.
    await prepare(`UPDATE core.notifications SET dispatched_at = now() WHERE id = ?`).run(row.id);
  }
  return { sent, skipped };
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const today = new Date().toISOString().slice(0, 10);
  const [push, recurring, timers] = await Promise.all([
    dispatchPush(),
    materializeDueRules(today),
    closeStaleTimers(),
  ]);
  return NextResponse.json({
    push,
    recurring_created: recurring.created,
    timers_closed: timers,
  });
}

export const GET = POST;
