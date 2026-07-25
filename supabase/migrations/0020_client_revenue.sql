-- Client revenue ledger — separate from KRs. Per (goal, client) entry holding
-- amount + active/churned status. Lives only on weekly goals (one row per
-- client per week); higher levels view a read-only aggregate computed on the
-- fly from week entries within the period.

CREATE TABLE IF NOT EXISTS public.client_revenue_entries (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','churned')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now(),
  UNIQUE (goal_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_client_revenue_goal
  ON public.client_revenue_entries(goal_id);
CREATE INDEX IF NOT EXISTS idx_client_revenue_client
  ON public.client_revenue_entries(client_id);

ALTER TABLE public.client_revenue_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allowed_users_all" ON public.client_revenue_entries;
CREATE POLICY "allowed_users_all" ON public.client_revenue_entries
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

ALTER PUBLICATION supabase_realtime ADD TABLE public.client_revenue_entries;
