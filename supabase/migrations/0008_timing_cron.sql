-- Schedule the time-tracking watchdog via pg_cron + pg_net.
-- Runs every 15 minutes; sends reminders / auto-stops stale active timers.
-- Requires Vault secrets: app_url, cron_secret (already created for 0005).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.invoke_timing_watchdog()
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
    url     := v_url || '/api/timing/watchdog',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 30000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_timing_watchdog() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.invoke_timing_watchdog() TO service_role;

-- Re-create schedule idempotently.
DO $$
DECLARE
  j RECORD;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'timing-watchdog'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

-- Every 15 minutes.
SELECT cron.schedule(
  'timing-watchdog',
  '*/15 * * * *',
  $$SELECT public.invoke_timing_watchdog()$$
);
