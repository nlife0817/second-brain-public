-- pg_cron schedules for planning system (V3).
-- Calls Vercel API with Bearer auth read from vault (app_url + cron_secret).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Helper: POST to a planning endpoint with bearer auth from vault.
CREATE OR REPLACE FUNCTION public.invoke_planning_cron(p_path TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_id     BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'app_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'Vault secrets app_url / cron_secret are not set';
  END IF;
  SELECT net.http_post(
    url     := v_url || p_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_planning_cron(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.invoke_planning_cron(TEXT) TO service_role;

-- Idempotent re-schedule.
DO $$
DECLARE j RECORD;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname IN ('planning-recurring-payments', 'planning-early-warning')
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

-- Daily 03:00 UTC — auto-create expected payments for production deals.
SELECT cron.schedule(
  'planning-recurring-payments',
  '0 3 * * *',
  $$SELECT public.invoke_planning_cron('/api/cron/planning/recurring-payments')$$
);

-- Weekly Monday 09:00 UTC — emit early-warning notifications.
SELECT cron.schedule(
  'planning-early-warning',
  '0 9 * * MON',
  $$SELECT public.invoke_planning_cron('/api/cron/planning/early-warning')$$
);
