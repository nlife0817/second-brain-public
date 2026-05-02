-- 1. Idempotently ENABLE RLS on every public table (defense in depth — Realtime
--    publishes postgres_changes for many of these tables to authenticated browser
--    clients using the publishable/anon key). The previous 0002_rls.sql created
--    policies but never enabled RLS — it had been enabled out-of-band via the
--    rls_auto_enable event trigger below, which we now also commit to migrations.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- 2. Event trigger that auto-enables RLS on any future public table so future
--    migrations cannot accidentally ship with RLS off.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
    IF cmd.schema_name = 'public' THEN
      BEGIN
        EXECUTE format('ALTER TABLE IF EXISTS %s ENABLE ROW LEVEL SECURITY', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();

-- 3. Lock down SECURITY DEFINER functions exposed via PostgREST (/rest/v1/rpc/*).
--    is_allowed_user() is used by RLS policies under the authenticated role, so
--    keep EXECUTE for authenticated but revoke from anon and PUBLIC — there is
--    no legitimate caller from outside the policy engine.
REVOKE EXECUTE ON FUNCTION public.is_allowed_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_allowed_user() FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_allowed_user() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_allowed_user() TO service_role;

-- rls_auto_enable() is only ever invoked by the event trigger. Nobody should
-- call it via RPC — revoke EXECUTE from every API-exposed role.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
