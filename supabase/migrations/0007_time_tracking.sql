-- Time tracking: per-user activity sessions with mutex on active timer + per-user settings.

-- ----------------------------------------------------------------------------
-- 1. Estimate field on items
-- ----------------------------------------------------------------------------
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER;

-- ----------------------------------------------------------------------------
-- 2. Per-user time tracking settings
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timing_settings (
  user_email            TEXT PRIMARY KEY REFERENCES public.users(email) ON DELETE CASCADE,
  idle_threshold_min    INTEGER NOT NULL DEFAULT 5
                          CHECK (idle_threshold_min BETWEEN 1 AND 120),
  reminder_interval_min INTEGER NOT NULL DEFAULT 60
                          CHECK (reminder_interval_min BETWEEN 5 AND 600),
  hard_cap_hours        INTEGER NOT NULL DEFAULT 4
                          CHECK (hard_cap_hours BETWEEN 1 AND 24),
  default_pomodoro      TEXT
                          CHECK (default_pomodoro IS NULL OR default_pomodoro IN ('25_5','50_10')),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. Time entries (work session journal)
--    - one row per start..stop. Active session has ended_at IS NULL.
--    - mutex enforced by partial unique index on (user_email) WHERE active.
--    - timestamps as TIMESTAMPTZ (not TEXT) — we need accurate arithmetic.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_entries (
  id                  TEXT PRIMARY KEY,
  user_email          TEXT NOT NULL REFERENCES public.users(email) ON DELETE CASCADE,
  item_id             TEXT NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  started_at          TIMESTAMPTZ NOT NULL,
  ended_at            TIMESTAMPTZ,
  last_heartbeat_at   TIMESTAMPTZ,
  last_active_at      TIMESTAMPTZ,
  reminder_sent_at    TIMESTAMPTZ,           -- last reminder push timestamp
  note                TEXT NOT NULL DEFAULT '',
  source              TEXT NOT NULL DEFAULT 'manual'
                        CHECK (source IN ('manual','auto_stop','idle_discard','mutex_replace','manual_edit','pomodoro_complete')),
  pomodoro_mode       TEXT
                        CHECK (pomodoro_mode IS NULL OR pomodoro_mode IN ('25_5','50_10')),
  pomodoro_phase      TEXT
                        CHECK (pomodoro_phase IS NULL OR pomodoro_phase IN ('focus','break')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- Mutex: at most one active timer per user.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_timer_per_user
  ON public.time_entries (user_email)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_user_started
  ON public.time_entries (user_email, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_entries_item
  ON public.time_entries (item_id, started_at DESC);

-- Lookup for watchdog: only active rows.
CREATE INDEX IF NOT EXISTS idx_time_entries_active_heartbeat
  ON public.time_entries (last_heartbeat_at)
  WHERE ended_at IS NULL;

-- ----------------------------------------------------------------------------
-- 4. RLS policies (event trigger from 0006_rls_lockdown auto-enables RLS).
--    Server-side code uses postgres role and bypasses RLS; these policies
--    only affect direct anon/authenticated SDK calls.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "allowed_users_all" ON public.time_entries;
CREATE POLICY "allowed_users_all" ON public.time_entries
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

DROP POLICY IF EXISTS "allowed_users_all" ON public.timing_settings;
CREATE POLICY "allowed_users_all" ON public.timing_settings
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

-- ----------------------------------------------------------------------------
-- 5. Aggregation helpers
-- ----------------------------------------------------------------------------

-- Per-item own time (excluding subtasks). Active row counted up to now().
CREATE OR REPLACE VIEW public.item_time_self AS
SELECT
  item_id,
  user_email,
  SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at)))::BIGINT AS seconds
FROM public.time_entries
GROUP BY item_id, user_email;

-- Recursive total: own time + sum over all descendants.
CREATE OR REPLACE FUNCTION public.item_time_total(p_item_id TEXT, p_user_email TEXT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE descendants(id) AS (
    SELECT p_item_id
    UNION ALL
    SELECT i.id FROM public.items i
      JOIN descendants d ON i.parent_id = d.id
  )
  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(te.ended_at, now()) - te.started_at)))::BIGINT, 0)
  FROM descendants d
  LEFT JOIN public.time_entries te
    ON te.item_id = d.id AND te.user_email = p_user_email;
$$;

REVOKE EXECUTE ON FUNCTION public.item_time_total(TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.item_time_total(TEXT, TEXT) TO authenticated, service_role;
