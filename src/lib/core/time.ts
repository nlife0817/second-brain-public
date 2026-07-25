// Тайм-трекинг: один активный таймер на пользователя (гарантирован partial unique
// index в БД), ручные записи и сводки. Ставок и биллинга нет — только учёт времени.

import { prepare, transaction } from "@/lib/sql";
import { DomainError } from "./http";
import { canOrg } from "./policy";
import { requireTaskAccess } from "./tasks";
import type { AuthContext } from "./types";

export interface TimeEntry {
  id: string;
  org_id: string;
  user_id: string;
  task_id: string | null;
  started_at: string;
  ended_at: string | null;
  seconds: number | null;
  source: "timer" | "manual";
  note: string;
}

export interface TimeEntryWithTask extends TimeEntry {
  task_title: string | null;
  user_name: string | null;
}

const MAX_TIMER_HOURS = 12;

export async function getActiveTimer(ctx: AuthContext): Promise<TimeEntryWithTask | null> {
  const row = await prepare<TimeEntryWithTask>(
    `SELECT e.*, t.title AS task_title, u.name AS user_name
     FROM core.time_entries e
     LEFT JOIN core.tasks t ON t.id = e.task_id
     LEFT JOIN core.users u ON u.id = e.user_id
     WHERE e.user_id = ? AND e.ended_at IS NULL`,
  ).get(ctx.user.id);
  return row ?? null;
}

/** Старт таймера: прежний активный останавливается — «переключение» задачи. */
export async function startTimer(
  ctx: AuthContext,
  taskId: string | null,
  note = "",
): Promise<TimeEntryWithTask> {
  if (taskId) await requireTaskAccess(ctx, taskId, "view");

  const id = await transaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE core.time_entries
         SET ended_at = now(), seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int)
         WHERE user_id = ? AND ended_at IS NULL`,
      )
      .run(ctx.user.id);
    const row = await tx
      .prepare<{ id: string }>(
        `INSERT INTO core.time_entries (org_id, user_id, task_id, note, source)
         VALUES (?, ?, ?, ?, 'timer') RETURNING id`,
      )
      .get(ctx.orgId, ctx.user.id, taskId, note);
    if (!row) throw new DomainError(500, "Failed to start timer");
    return row.id;
  });

  const entry = await getActiveTimer(ctx);
  if (!entry || entry.id !== id) throw new DomainError(500, "Timer state is inconsistent");
  return entry;
}

export async function stopTimer(ctx: AuthContext): Promise<TimeEntry | null> {
  const row = await prepare<TimeEntry>(
    `UPDATE core.time_entries
     SET ended_at = now(), seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int)
     WHERE user_id = ? AND ended_at IS NULL
     RETURNING *`,
  ).get(ctx.user.id);
  return row ?? null;
}

/**
 * Забытые таймеры: всё, что тикает дольше лимита, закрывается сторожем
 * (вызывается из cron; без него сутки «работы» попадут в отчёт).
 */
export async function closeStaleTimers(): Promise<number> {
  const res = await prepare(
    `UPDATE core.time_entries
     SET ended_at = started_at + interval '${MAX_TIMER_HOURS} hours',
         seconds = ${MAX_TIMER_HOURS * 3600}
     WHERE ended_at IS NULL AND started_at < now() - interval '${MAX_TIMER_HOURS} hours'`,
  ).run();
  return res.changes;
}

export async function listEntries(
  ctx: AuthContext,
  opts: { from?: string; to?: string; userId?: string; taskId?: string } = {},
): Promise<TimeEntryWithTask[]> {
  // Чужое время видят только админы организации.
  const targetUser =
    opts.userId && opts.userId !== ctx.user.id
      ? (canOrg(ctx, "org.members.manage") ? opts.userId : ctx.user.id)
      : opts.userId ?? ctx.user.id;

  const where: string[] = ["e.org_id = ?", "e.user_id = ?"];
  const params: unknown[] = [ctx.orgId, targetUser];
  if (opts.from) {
    where.push("e.started_at >= ?::date");
    params.push(opts.from);
  }
  if (opts.to) {
    where.push("e.started_at < (?::date + 1)");
    params.push(opts.to);
  }
  if (opts.taskId) {
    where.push("e.task_id = ?");
    params.push(opts.taskId);
  }
  return prepare<TimeEntryWithTask>(
    `SELECT e.*, t.title AS task_title, u.name AS user_name
     FROM core.time_entries e
     LEFT JOIN core.tasks t ON t.id = e.task_id
     LEFT JOIN core.users u ON u.id = e.user_id
     WHERE ${where.join(" AND ")}
     ORDER BY e.started_at DESC
     LIMIT 500`,
  ).all(...params);
}

export async function addManualEntry(
  ctx: AuthContext,
  input: { task_id?: string | null; started_at: string; ended_at: string; note?: string },
): Promise<TimeEntry> {
  if (input.task_id) await requireTaskAccess(ctx, input.task_id, "view");
  const start = new Date(input.started_at);
  const end = new Date(input.ended_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new DomainError(422, "Invalid timestamps");
  }
  if (end <= start) throw new DomainError(422, "End must be after start");
  const seconds = Math.round((end.getTime() - start.getTime()) / 1000);
  if (seconds > MAX_TIMER_HOURS * 3600) {
    throw new DomainError(422, `Manual entry cannot exceed ${MAX_TIMER_HOURS} hours`);
  }

  const row = await prepare<TimeEntry>(
    `INSERT INTO core.time_entries (org_id, user_id, task_id, started_at, ended_at, seconds, source, note)
     VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)
     RETURNING *`,
  ).get(ctx.orgId, ctx.user.id, input.task_id ?? null, input.started_at, input.ended_at, seconds, input.note ?? "");
  if (!row) throw new DomainError(500, "Failed to add entry");
  return row;
}

export async function deleteEntry(ctx: AuthContext, entryId: string): Promise<void> {
  const changed = await prepare(
    `DELETE FROM core.time_entries WHERE id = ? AND org_id = ? AND user_id = ?`,
  ).run(entryId, ctx.orgId, ctx.user.id);
  if (changed.changes === 0) throw new DomainError(404, "Entry not found");
}

export interface TimeSummaryRow {
  key: string;
  label: string;
  seconds: number;
}

/** Сводка за период: по людям (только для админов) или по задачам/проектам. */
export async function summary(
  ctx: AuthContext,
  opts: { from: string; to: string; groupBy: "user" | "task" | "project" },
): Promise<TimeSummaryRow[]> {
  const isAdmin = canOrg(ctx, "org.members.manage");
  const scope = isAdmin ? "" : "AND e.user_id = ?";
  const scopeParams = isAdmin ? [] : [ctx.user.id];

  if (opts.groupBy === "user") {
    if (!isAdmin) throw new DomainError(403, "Only org admins can see the team summary");
    return prepare<TimeSummaryRow>(
      `SELECT e.user_id::text AS key, COALESCE(NULLIF(u.name, ''), u.email) AS label,
              COALESCE(sum(e.seconds), 0)::int AS seconds
       FROM core.time_entries e JOIN core.users u ON u.id = e.user_id
       WHERE e.org_id = ? AND e.started_at >= ?::date AND e.started_at < (?::date + 1)
       GROUP BY e.user_id, u.name, u.email
       ORDER BY seconds DESC`,
    ).all(ctx.orgId, opts.from, opts.to);
  }

  if (opts.groupBy === "task") {
    return prepare<TimeSummaryRow>(
      `SELECT COALESCE(e.task_id::text, 'none') AS key,
              COALESCE(t.title, 'Без задачи') AS label,
              COALESCE(sum(e.seconds), 0)::int AS seconds
       FROM core.time_entries e LEFT JOIN core.tasks t ON t.id = e.task_id
       WHERE e.org_id = ? AND e.started_at >= ?::date AND e.started_at < (?::date + 1) ${scope}
       GROUP BY e.task_id, t.title
       ORDER BY seconds DESC
       LIMIT 100`,
    ).all(ctx.orgId, opts.from, opts.to, ...scopeParams);
  }

  return prepare<TimeSummaryRow>(
    `SELECT COALESCE(p.id::text, 'none') AS key,
            COALESCE(p.name, 'Без проекта') AS label,
            COALESCE(sum(e.seconds), 0)::int AS seconds
     FROM core.time_entries e
     LEFT JOIN core.task_projects tp ON tp.task_id = e.task_id
     LEFT JOIN core.projects p ON p.id = tp.project_id
     WHERE e.org_id = ? AND e.started_at >= ?::date AND e.started_at < (?::date + 1) ${scope}
     GROUP BY p.id, p.name
     ORDER BY seconds DESC
     LIMIT 100`,
  ).all(ctx.orgId, opts.from, opts.to, ...scopeParams);
}
