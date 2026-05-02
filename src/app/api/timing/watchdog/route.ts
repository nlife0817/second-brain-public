/**
 * Watchdog: invoked by pg_cron via pg_net every 15 minutes.
 *
 * For each active time_entry:
 *  - if last_heartbeat_at is older than user's reminder_interval_min and
 *    we haven't sent a reminder since last_heartbeat_at -> send push.
 *  - if last_heartbeat_at is older than user's hard_cap_hours -> auto-close
 *    the entry with ended_at = last_heartbeat_at, source = auto_stop, push.
 *
 * Authenticated via Bearer ${CRON_SECRET}. Path is in proxy.ts exclusion list.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getActiveEntriesWithSettings,
  markReminderSent,
  autoStopEntry,
} from "@/lib/timing-db";
import { sendPushToEmail } from "@/lib/notifications/push";

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[timing/watchdog] CRON_SECRET not configured — denying");
    return false;
  }
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

function fmtElapsed(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}м`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const active = await getActiveEntriesWithSettings();
  let reminded = 0;
  let autoStopped = 0;

  for (const entry of active) {
    const heartbeatTs = entry.last_heartbeat_at
      ? new Date(entry.last_heartbeat_at).getTime()
      : new Date(entry.started_at).getTime();
    const sinceHeartbeatMs = now.getTime() - heartbeatTs;

    const hardCapMs = entry.settings_hard_cap_hours * 3600 * 1000;
    const reminderMs = entry.settings_reminder_interval_min * 60 * 1000;

    // 1. Hard-cap → auto-stop.
    if (sinceHeartbeatMs >= hardCapMs) {
      const closeAt = entry.last_heartbeat_at
        ? new Date(entry.last_heartbeat_at)
        : new Date(entry.started_at);
      await autoStopEntry({ entryId: entry.id, endedAt: closeAt });
      autoStopped++;
      try {
        await sendPushToEmail(entry.user_email, {
          title: "⏹ Таймер автоостановлен",
          body: `«${entry.item_title}» — нет активности ${fmtElapsed(sinceHeartbeatMs)}. Проверь время.`,
          url: `/?item=${entry.item_id}`,
          tag: `timer-auto-stop-${entry.id}`,
          itemId: entry.item_id,
          requireInteraction: true,
        });
      } catch (e) {
        console.error("[timing/watchdog] auto-stop push failed", e);
      }
      continue;
    }

    // 2. Reminder push.
    const lastReminderTs = entry.reminder_sent_at
      ? new Date(entry.reminder_sent_at).getTime()
      : 0;
    const sinceLastReminderMs = now.getTime() - lastReminderTs;
    const shouldRemind =
      sinceHeartbeatMs >= reminderMs && sinceLastReminderMs >= reminderMs;

    if (shouldRemind) {
      const elapsedTotal = now.getTime() - new Date(entry.started_at).getTime();
      try {
        await sendPushToEmail(entry.user_email, {
          title: "⏱ Таймер всё ещё идёт",
          body: `«${entry.item_title}» — ${fmtElapsed(elapsedTotal)}. Остановить?`,
          url: `/?item=${entry.item_id}`,
          tag: `timer-reminder-${entry.id}`,
          itemId: entry.item_id,
          requireInteraction: true,
          actions: [{ action: "stop", title: "Остановить" }],
        });
        await markReminderSent(entry.id, now);
        reminded++;
      } catch (e) {
        console.error("[timing/watchdog] reminder push failed", e);
      }
    }
  }

  console.log(
    "[timing/watchdog] active=%d reminded=%d auto_stopped=%d",
    active.length,
    reminded,
    autoStopped,
  );

  return NextResponse.json({
    active: active.length,
    reminded,
    auto_stopped: autoStopped,
    server_now: now.toISOString(),
  });
}
