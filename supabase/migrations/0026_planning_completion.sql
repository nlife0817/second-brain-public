-- Planning system V3 — completion migration.
-- See planning_system_concept.md §3.11, §6.3, §6.7.5 + .claude/V3_COMPLETION_PLAN.md Phase A.

-- ============================================================================
-- 1. Seed ICP segments (concept §3.11) — was missing in 0023.
-- ============================================================================
INSERT INTO public.planning_icp_segments (title, position) VALUES
  ('Медицина',     10),
  ('Логистика',    20),
  ('Ритейл',       30),
  ('B2B-сервисы',  40),
  ('SMB Retail',   50),
  ('SMB Service',  60),
  ('Mid-Market',   70),
  ('Enterprise',   80)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 2. Extend notifications_log type CHECK to allow new alerts.
-- ============================================================================
ALTER TABLE public.notifications_log
  DROP CONSTRAINT IF EXISTS notifications_log_type_check;
ALTER TABLE public.notifications_log
  ADD CONSTRAINT notifications_log_type_check
  CHECK (type IN (
    'overdue_hour',
    'daily_summary',
    'date_only_morning',
    'planning_early_warning',
    'planning_kill_criteria',
    'planning_capacity_overload',
    'planning_pilot_overdue'
  ));

-- ============================================================================
-- 3. pg_cron schedules: support-initiative + pilot-overdue.
-- ============================================================================
DO $$
DECLARE j RECORD;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job
    WHERE jobname IN ('planning-support-initiative', 'planning-pilot-overdue')
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

-- 1st of Jan/Apr/Jul/Oct at 06:00 UTC — create "Поддержка Qx" initiative per direction.
SELECT cron.schedule(
  'planning-support-initiative',
  '0 6 1 1,4,7,10 *',
  $$SELECT public.invoke_planning_cron('/api/cron/planning/support-initiative')$$
);

-- Daily 07:00 UTC — flag pilots whose pilot_planned_end_at has passed.
SELECT cron.schedule(
  'planning-pilot-overdue',
  '0 7 * * *',
  $$SELECT public.invoke_planning_cron('/api/cron/planning/pilot-overdue')$$
);
