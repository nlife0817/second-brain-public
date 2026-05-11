import { NextRequest, NextResponse } from "next/server";
import { prepare } from "@/lib/sql";
import { getPlanningSettings, updateClientDeal, appendChangeLog } from "@/lib/db";

/**
 * Cron P8: автоматический переход сделок из «Пилот» в «Договор» когда
 * `pilot_planned_end_at < now()`. Поведение по подтверждению пользователя:
 * «По таймауту» — auto-transition (вариант a).
 *
 * Дополнительно эмитит notifications_log type='planning_pilot_overdue'
 * и пишет запись в planning_change_log с reason='pilot_window_ended'.
 *
 * Сделки с pilot_ended_at уже заполненным или другим статусом — пропускаются.
 * Если в settings нет production_status_id, переход не делается (только
 * уведомление как fallback).
 *
 * Concept §6.7.5. Auth: Bearer ${CRON_SECRET}.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getPlanningSettings();
  if (!settings.pilot_status_id) {
    return NextResponse.json({ skipped: "pilot_status_id not configured" });
  }

  const rows = await prepare<{
    id: string; title: string; pilot_planned_end_at: string; client_id: string;
  }>(
    `SELECT id, title, pilot_planned_end_at, client_id
     FROM client_deals
     WHERE status_id = ?
       AND pilot_ended_at IS NULL
       AND pilot_planned_end_at IS NOT NULL
       AND pilot_planned_end_at < now()`
  ).all(settings.pilot_status_id);

  let notificationsInserted = 0;
  let transitioned = 0;

  for (const r of rows) {
    // 1) Уведомление (идемпотентное через unique index).
    const dedupeKey = `planning_pilot_overdue:${r.id}:${r.pilot_planned_end_at.slice(0, 10)}`;
    const notifRes = await prepare(`
      INSERT INTO notifications_log (id, type, target_id, user_email, sent_at)
      VALUES (?, 'planning_pilot_overdue', ?, ?, ?)
      ON CONFLICT (type, target_id, user_email) DO NOTHING
    `).run(crypto.randomUUID(), dedupeKey, "system", new Date().toISOString());
    if (notifRes.changes > 0) notificationsInserted += 1;

    // 2) Авто-переход в Договор (production_status_id), если он задан.
    if (settings.production_status_id) {
      const updated = await updateClientDeal(r.id, { status_id: settings.production_status_id });
      if (updated) {
        transitioned += 1;
        // Лог в planning_change_log — для квартальной ретроспективы.
        await appendChangeLog({
          entity_type: "client_deal",
          entity_id: r.id,
          action: "auto_transition_to_production",
          diff: null,
          context: {
            reason: "pilot_window_ended",
            client_id: r.client_id,
            pilot_planned_end_at: r.pilot_planned_end_at,
          },
        });
      }
    }
  }

  return NextResponse.json({
    candidates: rows.length,
    notifications_inserted: notificationsInserted,
    transitioned_to_production: transitioned,
  });
}
