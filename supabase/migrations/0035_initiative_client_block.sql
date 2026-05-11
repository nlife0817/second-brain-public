-- P8: инициатива блокирует клиента (или конкретную сделку клиента) на стадии pilot/production.
-- Заменяет planning_initiative_deal_link.

CREATE TABLE IF NOT EXISTS public.planning_initiative_client_block (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id uuid NOT NULL REFERENCES public.planning_initiatives(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  deal_id uuid REFERENCES public.client_deals(id) ON DELETE CASCADE,
  blocks_stage text CHECK (blocks_stage IN ('pilot','production')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_initiative_client_block
  ON public.planning_initiative_client_block (initiative_id, client_id, deal_id)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_initiative_client_block_initiative
  ON public.planning_initiative_client_block(initiative_id);
CREATE INDEX IF NOT EXISTS idx_initiative_client_block_client
  ON public.planning_initiative_client_block(client_id);

ALTER TABLE public.planning_initiative_client_block ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allowed_users_all" ON public.planning_initiative_client_block;
CREATE POLICY "allowed_users_all" ON public.planning_initiative_client_block
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

ALTER PUBLICATION supabase_realtime ADD TABLE public.planning_initiative_client_block;
