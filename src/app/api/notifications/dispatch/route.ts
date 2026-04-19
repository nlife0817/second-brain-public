import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { fromZonedTime, toZonedTime, format as formatTz } from "date-fns-tz";
import { prepare } from "@/lib/sql";
import { sendPushToEmail } from "@/lib/notifications/push";

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

type UserRow = { email: string; timezone: string };
type ItemRow = {
  id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  status: string;
  category: string;
};
type CategoryRow = { id: string; name: string };

async function getActiveUsers(): Promise<UserRow[]> {
  // Only users who have at least one push subscription.
  return await prepare<UserRow>(`
    SELECT DISTINCT u.email, u.timezone FROM users u
    JOIN push_subscriptions s ON s.user_email = u.email
  `).all();
}

async function logSent(type: string, targetId: string, userEmail: string): Promise<boolean> {
  try {
    await prepare(
      "INSERT INTO notifications_log (id, type, target_id, user_email) VALUES (?, ?, ?, ?)"
    ).run(uuid(), type, targetId, userEmail);
    return true;
  } catch {
    return false; // Unique constraint — already sent.
  }
}

function parseDue(dateStr: string, timeStr: string | null, tz: string): Date | null {
  const hhmm = timeStr && /^\d{2}:\d{2}$/.test(timeStr) ? timeStr : "00:00";
  const localIso = `${dateStr}T${hhmm}:00`;
  try {
    return fromZonedTime(localIso, tz);
  } catch {
    return null;
  }
}

function todayInTz(now: Date, tz: string): string {
  return formatTz(toZonedTime(now, tz), "yyyy-MM-dd", { timeZone: tz });
}

function tomorrowInTz(now: Date, tz: string): string {
  const next = new Date(now.getTime() + 24 * 3600 * 1000);
  return formatTz(toZonedTime(next, tz), "yyyy-MM-dd", { timeZone: tz });
}

// -----------------------------------------------------------------------------
// Type 1: push 1 hour before deadline (for items with due_time).
// Runs every hour at :00. Looks for items whose deadline is 55-65 min from now.
// -----------------------------------------------------------------------------
async function dispatchOverdueHour() {
  const now = new Date();
  const users = await getActiveUsers();
  let sent = 0;
  const skipped: string[] = [];

  for (const user of users) {
    const items = await prepare<ItemRow>(`
      SELECT id, title, due_date, due_time, status, category
      FROM items
      WHERE due_date IS NOT NULL AND due_time IS NOT NULL
        AND status NOT IN ('done', 'archived')
    `).all();

    for (const item of items) {
      if (!item.due_date || !item.due_time) continue;
      const deadline = parseDue(item.due_date, item.due_time, user.timezone);
      if (!deadline) continue;
      const diffMin = (deadline.getTime() - now.getTime()) / 60000;
      if (diffMin < 55 || diffMin > 65) continue;

      if (!(await logSent("overdue_hour", item.id, user.email))) {
        skipped.push(item.id);
        continue;
      }
      const result = await sendPushToEmail(user.email, {
        title: `⏰ Через час: ${item.title}`,
        body: `Дедлайн в ${item.due_time}`,
        url: `/?item=${item.id}`,
        tag: `overdue-${item.id}`,
        itemId: item.id,
        requireInteraction: true,
      });
      sent += result.sent;
    }
  }
  return { type: "overdue_hour", sent, skipped };
}

// -----------------------------------------------------------------------------
// Type 2: morning push in day of the deadline (date-only items).
// Runs at 06:00 UTC == 09:00 MSK.
// -----------------------------------------------------------------------------
async function dispatchDateOnlyMorning() {
  const now = new Date();
  const users = await getActiveUsers();
  let sent = 0;
  const skipped: string[] = [];

  for (const user of users) {
    const today = todayInTz(now, user.timezone);
    const items = await prepare<ItemRow>(`
      SELECT id, title, due_date, due_time, status, category
      FROM items
      WHERE due_date = ? AND due_time IS NULL
        AND status NOT IN ('done', 'archived')
    `).all(today);

    for (const item of items) {
      if (!(await logSent("date_only_morning", `${item.id}:${today}`, user.email))) {
        skipped.push(item.id);
        continue;
      }
      const result = await sendPushToEmail(user.email, {
        title: `📅 Сегодня дедлайн: ${item.title}`,
        body: "Дата без точного времени",
        url: `/?item=${item.id}`,
        tag: `date-only-${item.id}`,
        itemId: item.id,
      });
      sent += result.sent;
    }
  }
  return { type: "date_only_morning", sent, skipped };
}

// -----------------------------------------------------------------------------
// Type 3: daily evening summary.
// Runs at 18:00 UTC == 21:00 MSK.
// Includes: tasks with due_date = tomorrow + overdue tasks (date < today, not done).
// -----------------------------------------------------------------------------
async function dispatchDailySummary() {
  const now = new Date();
  const users = await getActiveUsers();
  let sent = 0;
  const summaries: Array<{ email: string; text: string }> = [];

  // Pre-load all categories once.
  const categories = await prepare<CategoryRow>("SELECT id, name FROM categories").all();
  const catById = new Map(categories.map((c) => [c.id, c.name]));

  for (const user of users) {
    const today = todayInTz(now, user.timezone);
    const tomorrow = tomorrowInTz(now, user.timezone);

    const tomorrowItems = await prepare<ItemRow>(`
      SELECT id, title, due_date, due_time, status, category
      FROM items
      WHERE due_date = ? AND status NOT IN ('done', 'archived')
      ORDER BY due_time NULLS LAST, title
    `).all(tomorrow);

    const overdueItems = await prepare<ItemRow>(`
      SELECT id, title, due_date, due_time, status, category
      FROM items
      WHERE due_date < ? AND status NOT IN ('done', 'archived')
      ORDER BY due_date DESC, title
    `).all(today);

    const total = tomorrowItems.length + overdueItems.length;
    if (total === 0) {
      summaries.push({ email: user.email, text: "(пусто)" });
      continue;
    }

    const logKey = `summary:${tomorrow}`;
    if (!(await logSent("daily_summary", logKey, user.email))) {
      summaries.push({ email: user.email, text: "(already sent)" });
      continue;
    }

    const lines: string[] = [];
    if (tomorrowItems.length > 0) {
      lines.push(`📅 Завтра (${tomorrowItems.length}):`);
      for (const item of tomorrowItems.slice(0, 8)) {
        const cat = catById.get(item.category) ?? "";
        const timePart = item.due_time ? `${item.due_time} · ` : "";
        const catPart = cat ? ` · ${cat}` : "";
        lines.push(`• ${timePart}${item.title}${catPart}`);
      }
      if (tomorrowItems.length > 8) {
        lines.push(`  …ещё ${tomorrowItems.length - 8}`);
      }
    }
    if (overdueItems.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push(`❗ Просрочено (${overdueItems.length}):`);
      for (const item of overdueItems.slice(0, 5)) {
        lines.push(`• ${item.title} (${item.due_date})`);
      }
      if (overdueItems.length > 5) {
        lines.push(`  …ещё ${overdueItems.length - 5}`);
      }
    }

    const body = lines.join("\n");
    const result = await sendPushToEmail(user.email, {
      title: `📋 Сводка на завтра (${tomorrow})`,
      body,
      url: "/",
      tag: "daily-summary",
      requireInteraction: true,
    });
    sent += result.sent;
    summaries.push({ email: user.email, text: body });
  }

  return { type: "daily_summary", sent, summaries };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const type = req.nextUrl.searchParams.get("type");
  try {
    switch (type) {
      case "overdue_hour":
        return NextResponse.json(await dispatchOverdueHour());
      case "date_only_morning":
        return NextResponse.json(await dispatchDateOnlyMorning());
      case "daily_summary":
        return NextResponse.json(await dispatchDailySummary());
      default:
        return NextResponse.json(
          { error: "invalid type; expected overdue_hour | date_only_morning | daily_summary" },
          { status: 400 }
        );
    }
  } catch (e) {
    console.error("[notifications/dispatch] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Dispatch failed" },
      { status: 500 }
    );
  }
}
