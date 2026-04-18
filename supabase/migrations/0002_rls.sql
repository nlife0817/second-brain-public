-- RLS policies: whitelist-based access for authenticated users.
-- Server-side code connects as role `postgres` via DATABASE_URL — RLS is bypassed there.
-- These policies only affect clients using anon key + authenticated JWT (Realtime, direct SDK calls).

-- Helper: check if the current JWT email is in public.users whitelist.
-- SECURITY DEFINER lets it bypass RLS on the users table during the sub-select
-- (otherwise calling this from an items policy would recurse into users policy).
CREATE OR REPLACE FUNCTION public.is_allowed_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email')
  );
$$;

-- Apply a uniform "allowed users full access" policy to every public table.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    -- Drop policy if exists (idempotent re-runs).
    EXECUTE format('DROP POLICY IF EXISTS "allowed_users_all" ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY "allowed_users_all" ON public.%I
         FOR ALL TO authenticated
         USING (public.is_allowed_user())
         WITH CHECK (public.is_allowed_user());', t);
  END LOOP;
END $$;

-- Enable Realtime publication for tables the client subscribes to.
-- Leave static/integration tables out to reduce WebSocket traffic.
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.items,
  public.item_tags,
  public.tags,
  public.categories,
  public.item_development_participants,
  public.development_participants,
  public.development_stages,
  public.weekly_plans,
  public.weekly_plan_entries,
  public.entry_comments,
  public.clients,
  public.client_statuses,
  public.client_companies,
  public.client_contacts,
  public.client_contact_fields,
  public.client_notes,
  public.client_links,
  public.client_crm_systems,
  public.crm_systems,
  public.relation_types,
  public.relations,
  public.comments,
  public.staging_items;
