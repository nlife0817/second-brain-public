-- Schedule notification dispatch via Supabase pg_cron + pg_net.
-- Calls our Vercel API every hour / morning / evening using Vault-stored secrets.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Helper: invoke /api/notifications/dispatch?type=<p_type> with bearer auth.
-- Reads `app_url` and `cron_secret` from Vault (must be created manually in Dashboard).
CREATE OR REPLACE FUNCTION public.invoke_notifications_dispatch(p_type TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
  v_request_id BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'app_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'Vault secrets app_url / cron_secret are not set';
  END IF;
  SELECT net.http_get(
    url     := v_url || '/api/notifications/dispatch?type=' || p_type,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 30000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$$;

-- Restrict execution to service_role only (cron runs as postgres which bypasses).
REVOKE ALL ON FUNCTION public.invoke_notifications_dispatch(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.invoke_notifications_dispatch(TEXT) TO service_role;

-- Re-create schedules idempotently. Times are UTC; user TZ Asia/Novosibirsk = UTC+7.
DO $$
DECLARE
  j RECORD;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname IN ('notif-overdue-hour', 'notif-date-only-morning', 'notif-daily-summary')
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

-- Каждый час в :00 UTC — пуш за час до дедлайна (для items с due_time).
SELECT cron.schedule(
  'notif-overdue-hour',
  '0 * * * *',
  $$SELECT public.invoke_notifications_dispatch('overdue_hour')$$
);

-- 03:00 UTC = 10:00 НСК — утренний пуш для дедлайнов сегодня без времени.
SELECT cron.schedule(
  'notif-date-only-morning',
  '0 3 * * *',
  $$SELECT public.invoke_notifications_dispatch('date_only_morning')$$
);

-- 14:00 UTC = 21:00 НСК — вечерняя сводка на завтра + просрочки.
SELECT cron.schedule(
  'notif-daily-summary',
  '0 14 * * *',
  $$SELECT public.invoke_notifications_dispatch('daily_summary')$$
);
