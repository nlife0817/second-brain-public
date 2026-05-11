-- P8: сделка — это запись внутри клиента. У клиента может быть N сделок.
-- Стадия определяется status_id (FK на client_statuses — те же, что у самого клиента);
-- pilot/production timestamps хранятся прямо на сделке для авто-fill через trigger.

CREATE TABLE IF NOT EXISTS public.client_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  status_id text REFERENCES public.client_statuses(id) ON DELETE SET NULL,
  pilot_started_at timestamptz,
  pilot_default_duration_days int NOT NULL DEFAULT 30,
  pilot_planned_end_at timestamptz,
  pilot_ended_at timestamptz,
  production_started_at timestamptz,
  min_monthly_amount numeric,
  expected_actual_amount numeric,
  description text,
  status_changed_at timestamptz,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_deals_client ON public.client_deals(client_id);
CREATE INDEX IF NOT EXISTS idx_client_deals_status ON public.client_deals(status_id);

ALTER TABLE public.client_deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allowed_users_all" ON public.client_deals;
CREATE POLICY "allowed_users_all" ON public.client_deals
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

ALTER PUBLICATION supabase_realtime ADD TABLE public.client_deals;

CREATE OR REPLACE FUNCTION public.client_deals_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS client_deals_touch_updated_at_trg ON public.client_deals;
CREATE TRIGGER client_deals_touch_updated_at_trg
  BEFORE UPDATE ON public.client_deals
  FOR EACH ROW EXECUTE FUNCTION public.client_deals_touch_updated_at();
