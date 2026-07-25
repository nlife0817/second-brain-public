import { v4 as uuid } from "uuid";
import { prepare, transaction } from "./sql";
import type {
  TimeEntry,
  TimeEntrySource,
  TimingSettings,
  TimingSettingsInput,
  PomodoroMode,
  ItemTimeTotals,
} from "@/types";
import { TIMING_SETTINGS_DEFAULTS } from "@/types";

// ----------------------------------------------------------------------------
// Time entries
// ----------------------------------------------------------------------------

/**
 * Get the user's currently active (unstopped) timer, if any.
 */
export async function getActiveEntry(userEmail: string): Promise<TimeEntry | undefined> {
  return await prepare<TimeEntry>(
    "SELECT * FROM time_entries WHERE user_email = ? AND ended_at IS NULL"
  ).get(userEmail);
}

/**
 * Start a new timer on `itemId`. Atomically closes any currently active timer
 * for the user (mutex), then inserts a fresh row. Returns the new active entry
 * and the replaced one (if any) for the "Undo" toast.
 *
 * If `clientRequestId` is provided and a row already exists for it, that row
 * is returned without changes — idempotent retry support for flaky networks.
 */
export async function startTimer(opts: {
  userEmail: string;
  itemId: string;
  pomodoroMode?: PomodoroMode | null;
  clientRequestId?: string | null;
  now?: Date;
}): Promise<{ entry: TimeEntry; replaced: TimeEntry | null }> {
  const now = (opts.now ?? new Date()).toISOString();
  const newId = uuid();
  const cri = opts.clientRequestId ?? null;

  const result = await transaction(async (tx) => {
    // Idempotency: if this client_request_id already produced a row, return it.
    if (cri) {
      const existing = await tx.prepare<TimeEntry>(
        "SELECT * FROM time_entries WHERE user_email = ? AND client_request_id = ?"
      ).get(opts.userEmail, cri);
      if (existing) return { entry: existing, replaced: null as TimeEntry | null };
    }

    // Close any currently active entry as `mutex_replace`.
    const replaced = await tx.prepare<TimeEntry>(`
      UPDATE time_entries
      SET ended_at = ?, source = 'mutex_replace', updated_at = ?
      WHERE user_email = ? AND ended_at IS NULL
      RETURNING *
    `).get(now, now, opts.userEmail);

    // Insert new active entry.
    await tx.prepare(`
      INSERT INTO time_entries (
        id, user_email, item_id, started_at, last_heartbeat_at, last_active_at,
        source, pomodoro_mode, pomodoro_phase, client_request_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)
    `).run(
      newId,
      opts.userEmail,
      opts.itemId,
      now,
      now,
      now,
      opts.pomodoroMode ?? null,
      opts.pomodoroMode ? "focus" : null,
      cri,
      now,
      now,
    );

    const entry = await tx.prepare<TimeEntry>(
      "SELECT * FROM time_entries WHERE id = ?"
    ).get(newId);
    if (!entry) throw new Error("startTimer: failed to insert entry");
    return { entry, replaced: replaced ?? null };
  });

  return result;
}

/**
 * Undo a recent mutex_replace: close the current active entry and resurrect
 * the previously-closed one (set ended_at = NULL, source back to 'manual').
 *
 * Validates: caller owns both rows, replaced entry was closed via mutex_replace
 * within the last `maxAgeMs` ms, current active matches expected id.
 */
export async function undoMutexReplace(opts: {
  userEmail: string;
  currentActiveId: string;
  replacedEntryId: string;
  maxAgeMs?: number;
}): Promise<{ resurrected: TimeEntry | null }> {
  const maxAgeMs = opts.maxAgeMs ?? 60_000;
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const now = new Date().toISOString();

  return await transaction(async (tx) => {
    // 1. Verify replaced entry: belongs to user, mutex_replace, recent.
    const replaced = await tx.prepare<TimeEntry>(`
      SELECT * FROM time_entries
      WHERE id = ? AND user_email = ? AND source = 'mutex_replace'
        AND ended_at IS NOT NULL AND ended_at >= ?
    `).get(opts.replacedEntryId, opts.userEmail, cutoff);
    if (!replaced) return { resurrected: null };

    // 2. Verify current active matches.
    const current = await tx.prepare<TimeEntry>(`
      SELECT * FROM time_entries
      WHERE id = ? AND user_email = ? AND ended_at IS NULL
    `).get(opts.currentActiveId, opts.userEmail);
    if (!current) return { resurrected: null };

    // 3. Hard-delete the brand-new entry (it was a mistake — no learning value
    //    from keeping a 2-second session in history).
    await tx.prepare(
      "DELETE FROM time_entries WHERE id = ? AND user_email = ?"
    ).run(opts.currentActiveId, opts.userEmail);

    // 4. Resurrect: clear ended_at, restore source to 'manual'.
    await tx.prepare(`
      UPDATE time_entries
      SET ended_at = NULL, source = 'manual', updated_at = ?
      WHERE id = ? AND user_email = ?
    `).run(now, opts.replacedEntryId, opts.userEmail);

    const resurrected = await tx.prepare<TimeEntry>(
      "SELECT * FROM time_entries WHERE id = ?"
    ).get(opts.replacedEntryId);
    return { resurrected: resurrected ?? null };
  });
}

/**
 * Stop the currently active timer for the user.
 * Returns the closed entry, or undefined if no active timer.
 */
export async function stopActiveTimer(opts: {
  userEmail: string;
  endedAt?: Date;
  source?: TimeEntrySource;
  note?: string;
}): Promise<TimeEntry | undefined> {
  const endedAt = (opts.endedAt ?? new Date()).toISOString();
  const source = opts.source ?? "manual";
  const note = opts.note;

  const active = await getActiveEntry(opts.userEmail);
  if (!active) return undefined;

  if (note !== undefined) {
    await prepare(`
      UPDATE time_entries
      SET ended_at = ?, source = ?, note = ?, updated_at = ?
      WHERE id = ?
    `).run(endedAt, source, note, endedAt, active.id);
  } else {
    await prepare(`
      UPDATE time_entries
      SET ended_at = ?, source = ?, updated_at = ?
      WHERE id = ?
    `).run(endedAt, source, endedAt, active.id);
  }

  return await prepare<TimeEntry>(
    "SELECT * FROM time_entries WHERE id = ?"
  ).get(active.id);
}

/**
 * Heartbeat from the client: updates last_heartbeat_at + last_active_at on
 * the user's active entry. No-op if there is no active entry.
 * Returns the updated entry, or undefined if no active timer.
 */
export async function recordHeartbeat(opts: {
  userEmail: string;
  lastActiveAt?: Date;
  now?: Date;
}): Promise<TimeEntry | undefined> {
  const heartbeat = (opts.now ?? new Date()).toISOString();
  const lastActive = (opts.lastActiveAt ?? opts.now ?? new Date()).toISOString();

  const result = await prepare<TimeEntry>(`
    UPDATE time_entries
    SET last_heartbeat_at = ?, last_active_at = ?, updated_at = ?
    WHERE user_email = ? AND ended_at IS NULL
    RETURNING *
  `).get(heartbeat, lastActive, heartbeat, opts.userEmail);

  return result;
}

/**
 * Discard idle time: close active entry with ended_at = cutAt (typically the
 * client's last_active_at), source = idle_discard. Optionally restart a new
 * timer on the same item immediately.
 */
export async function discardIdle(opts: {
  userEmail: string;
  cutAt: Date;
  restart?: boolean;
}): Promise<{ closed: TimeEntry | undefined; new: TimeEntry | undefined }> {
  const cutIso = opts.cutAt.toISOString();
  const now = new Date().toISOString();

  return await transaction(async (tx) => {
    const active = await tx.prepare<TimeEntry>(
      "SELECT * FROM time_entries WHERE user_email = ? AND ended_at IS NULL"
    ).get(opts.userEmail);

    if (!active) return { closed: undefined, new: undefined };

    // Clamp cutAt to [started_at, now].
    let endedAt = cutIso;
    if (new Date(cutIso) < new Date(active.started_at)) endedAt = active.started_at;
    if (new Date(cutIso) > new Date(now)) endedAt = now;

    await tx.prepare(`
      UPDATE time_entries
      SET ended_at = ?, source = 'idle_discard', updated_at = ?
      WHERE id = ?
    `).run(endedAt, now, active.id);

    const closed = await tx.prepare<TimeEntry>(
      "SELECT * FROM time_entries WHERE id = ?"
    ).get(active.id);

    if (!opts.restart) return { closed, new: undefined };

    const newId = uuid();
    await tx.prepare(`
      INSERT INTO time_entries (
        id, user_email, item_id, started_at, last_heartbeat_at, last_active_at,
        source, pomodoro_mode, pomodoro_phase, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)
    `).run(
      newId,
      active.user_email,
      active.item_id,
      now,
      now,
      now,
      active.pomodoro_mode ?? null,
      active.pomodoro_mode ? "focus" : null,
      now,
      now,
    );

    const fresh = await tx.prepare<TimeEntry>(
      "SELECT * FROM time_entries WHERE id = ?"
    ).get(newId);

    return { closed, new: fresh };
  });
}

export async function getEntryById(id: string, userEmail: string): Promise<TimeEntry | undefined> {
  return await prepare<TimeEntry>(
    "SELECT * FROM time_entries WHERE id = ? AND user_email = ?"
  ).get(id, userEmail);
}

export async function listEntries(opts: {
  userEmail: string;
  itemId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<TimeEntry[]> {
  const conds: string[] = ["user_email = ?"];
  const params: unknown[] = [opts.userEmail];
  if (opts.itemId) {
    conds.push("item_id = ?");
    params.push(opts.itemId);
  }
  if (opts.from) {
    conds.push("started_at >= ?");
    params.push(opts.from.toISOString());
  }
  if (opts.to) {
    conds.push("started_at < ?");
    params.push(opts.to.toISOString());
  }
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);

  return await prepare<TimeEntry>(
    `SELECT * FROM time_entries WHERE ${conds.join(" AND ")} ORDER BY started_at DESC LIMIT ${limit}`
  ).all(...params);
}

/**
 * Insert a manual time entry (e.g. "I forgot to start the timer — log 10:00→12:00").
 * Rejects if it would overlap with the active timer.
 */
export async function insertManualEntry(opts: {
  userEmail: string;
  itemId: string;
  startedAt: Date;
  endedAt: Date;
  note?: string;
}): Promise<TimeEntry> {
  if (opts.endedAt <= opts.startedAt) {
    throw new Error("ended_at must be after started_at");
  }
  const now = new Date().toISOString();
  const id = uuid();

  await transaction(async (tx) => {
    // Check for overlap with active session (we only block against *active*; closed
    // overlaps are allowed — manual edits/corrections happen).
    const active = await tx.prepare<TimeEntry>(
      "SELECT * FROM time_entries WHERE user_email = ? AND ended_at IS NULL"
    ).get(opts.userEmail);
    if (active && new Date(active.started_at) < opts.endedAt) {
      throw new Error("manual entry would overlap the active timer; stop it first");
    }

    await tx.prepare(`
      INSERT INTO time_entries (
        id, user_email, item_id, started_at, ended_at,
        source, note, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'manual_edit', ?, ?, ?)
    `).run(
      id,
      opts.userEmail,
      opts.itemId,
      opts.startedAt.toISOString(),
      opts.endedAt.toISOString(),
      opts.note ?? "",
      now,
      now,
    );
  });

  const entry = await prepare<TimeEntry>(
    "SELECT * FROM time_entries WHERE id = ?"
  ).get(id);
  if (!entry) throw new Error("insertManualEntry: failed to insert");
  return entry;
}

export async function updateEntry(opts: {
  id: string;
  userEmail: string;
  startedAt?: Date;
  endedAt?: Date;
  note?: string;
}): Promise<TimeEntry | undefined> {
  const existing = await getEntryById(opts.id, opts.userEmail);
  if (!existing) return undefined;
  if (existing.ended_at === null) {
    throw new Error("cannot edit an active entry; stop it first");
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  if (opts.startedAt) {
    fields.push("started_at = ?");
    values.push(opts.startedAt.toISOString());
  }
  if (opts.endedAt) {
    fields.push("ended_at = ?");
    values.push(opts.endedAt.toISOString());
  }
  if (opts.note !== undefined) {
    fields.push("note = ?");
    values.push(opts.note);
  }
  if (fields.length === 0) return existing;

  // Validate ordering.
  const newStart = opts.startedAt?.toISOString() ?? existing.started_at;
  const newEnd = opts.endedAt?.toISOString() ?? existing.ended_at;
  if (newEnd && new Date(newEnd) < new Date(newStart)) {
    throw new Error("ended_at must be >= started_at");
  }

  fields.push("source = 'manual_edit'");
  fields.push("updated_at = ?");
  values.push(new Date().toISOString());

  await prepare(
    `UPDATE time_entries SET ${fields.join(", ")} WHERE id = ? AND user_email = ?`
  ).run(...values, opts.id, opts.userEmail);

  return await getEntryById(opts.id, opts.userEmail);
}

export async function deleteEntry(id: string, userEmail: string): Promise<boolean> {
  const result = await prepare(
    "DELETE FROM time_entries WHERE id = ? AND user_email = ? AND ended_at IS NOT NULL"
  ).run(id, userEmail);
  return result.changes > 0;
}

// ----------------------------------------------------------------------------
// Watchdog (cron-only)
// ----------------------------------------------------------------------------

/**
 * Returns all currently active entries with their associated user settings.
 * Used by the watchdog to send reminders / auto-stop stale timers.
 */
export async function getActiveEntriesWithSettings(): Promise<
  Array<TimeEntry & {
    settings_idle_threshold_min: number;
    settings_reminder_interval_min: number;
    settings_hard_cap_hours: number;
    item_title: string;
  }>
> {
  return await prepare<TimeEntry & {
    settings_idle_threshold_min: number;
    settings_reminder_interval_min: number;
    settings_hard_cap_hours: number;
    item_title: string;
  }>(`
    SELECT te.*,
      COALESCE(ts.idle_threshold_min, ${TIMING_SETTINGS_DEFAULTS.idle_threshold_min}) AS settings_idle_threshold_min,
      COALESCE(ts.reminder_interval_min, ${TIMING_SETTINGS_DEFAULTS.reminder_interval_min}) AS settings_reminder_interval_min,
      COALESCE(ts.hard_cap_hours, ${TIMING_SETTINGS_DEFAULTS.hard_cap_hours}) AS settings_hard_cap_hours,
      COALESCE(i.title, '') AS item_title
    FROM time_entries te
    LEFT JOIN timing_settings ts ON ts.user_email = te.user_email
    LEFT JOIN items i ON i.id = te.item_id
    WHERE te.ended_at IS NULL
  `).all();
}

/**
 * Mark reminder push as sent for an active entry.
 */
export async function markReminderSent(entryId: string, now?: Date): Promise<void> {
  const ts = (now ?? new Date()).toISOString();
  await prepare(
    "UPDATE time_entries SET reminder_sent_at = ?, updated_at = ? WHERE id = ?"
  ).run(ts, ts, entryId);
}

/**
 * Auto-close an entry: ended_at = clampedEndedAt (typically last_heartbeat_at),
 * source = auto_stop. Used by the watchdog when a timer is stale beyond
 * hard_cap_hours.
 */
export async function autoStopEntry(opts: {
  entryId: string;
  endedAt: Date;
}): Promise<void> {
  const ended = opts.endedAt.toISOString();
  await prepare(`
    UPDATE time_entries
    SET ended_at = ?, source = 'auto_stop', updated_at = ?
    WHERE id = ? AND ended_at IS NULL
  `).run(ended, ended, opts.entryId);
}

// ----------------------------------------------------------------------------
// Aggregation
// ----------------------------------------------------------------------------

/**
 * Per-item time totals for a single item: own seconds + recursive total
 * (own + all descendants).
 */
export async function getItemTimeTotals(
  userEmail: string,
  itemId: string,
): Promise<ItemTimeTotals> {
  const selfRow = await prepare<{ seconds: string | number | null }>(
    "SELECT seconds FROM item_time_self WHERE item_id = ? AND user_email = ?"
  ).get(itemId, userEmail);
  const totalRow = await prepare<{ total: string | number | null }>(
    "SELECT public.item_time_total(?, ?) AS total"
  ).get(itemId, userEmail);

  return {
    item_id: itemId,
    self_seconds: Number(selfRow?.seconds ?? 0),
    total_seconds: Number(totalRow?.total ?? 0),
  };
}

/**
 * Bulk: { item_id => self_seconds } for *all* user's items.
 * Recursive totals are computed on demand on the client (small data) or via
 * getItemTimeTotals() per item.
 */
export async function getAllItemSelfTotals(
  userEmail: string,
): Promise<Map<string, number>> {
  const rows = await prepare<{ item_id: string; seconds: string | number }>(
    "SELECT item_id, seconds FROM item_time_self WHERE user_email = ?"
  ).all(userEmail);
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.item_id, Number(r.seconds));
  return map;
}

// ----------------------------------------------------------------------------
// Settings
// ----------------------------------------------------------------------------

export async function getTimingSettings(userEmail: string): Promise<TimingSettings> {
  const row = await prepare<TimingSettings>(
    "SELECT * FROM timing_settings WHERE user_email = ?"
  ).get(userEmail);
  if (row) return row;
  return {
    user_email: userEmail,
    ...TIMING_SETTINGS_DEFAULTS,
    updated_at: new Date().toISOString(),
  };
}

export async function upsertTimingSettings(
  userEmail: string,
  input: TimingSettingsInput,
): Promise<TimingSettings> {
  const current = await getTimingSettings(userEmail);
  const merged = { ...current, ...input };
  const now = new Date().toISOString();

  await prepare(`
    INSERT INTO timing_settings (
      user_email, idle_threshold_min, reminder_interval_min, hard_cap_hours,
      default_pomodoro, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_email) DO UPDATE SET
      idle_threshold_min = EXCLUDED.idle_threshold_min,
      reminder_interval_min = EXCLUDED.reminder_interval_min,
      hard_cap_hours = EXCLUDED.hard_cap_hours,
      default_pomodoro = EXCLUDED.default_pomodoro,
      updated_at = EXCLUDED.updated_at
  `).run(
    userEmail,
    merged.idle_threshold_min,
    merged.reminder_interval_min,
    merged.hard_cap_hours,
    merged.default_pomodoro,
    now,
  );

  return (await getTimingSettings(userEmail));
}
