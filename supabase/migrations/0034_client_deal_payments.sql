-- P8: платежи на сделке клиента (заменяет planning_deal_payments).

CREATE TABLE IF NOT EXISTS public.client_deal_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.client_deals(id) ON DELETE CASCADE,
  paid_at date NOT NULL,
  amount numeric NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'expected' CHECK (status IN ('expected','confirmed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_deal_payments_deal_paid
  ON public.client_deal_payments(deal_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_client_deal_payments_paid
  ON public.client_deal_payments(paid_at);

ALTER TABLE public.client_deal_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allowed_users_all" ON public.client_deal_payments;
CREATE POLICY "allowed_users_all" ON public.client_deal_payments
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

ALTER PUBLICATION supabase_realtime ADD TABLE public.client_deal_payments;

CREATE OR REPLACE FUNCTION public.client_deal_payments_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS client_deal_payments_touch_updated_at_trg ON public.client_deal_payments;
CREATE TRIGGER client_deal_payments_touch_updated_at_trg
  BEFORE UPDATE ON public.client_deal_payments
  FOR EACH ROW EXECUTE FUNCTION public.client_deal_payments_touch_updated_at();
