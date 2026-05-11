-- P8: дроп legacy сущности «сделок» — переезд в client_deals (см. 0033-0035).
-- В таблицах было 0 строк, проверено перед миграцией.

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.planning_initiative_deal_link;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.planning_deal_payments;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.planning_deals;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DROP TABLE IF EXISTS public.planning_initiative_deal_link CASCADE;
DROP TABLE IF EXISTS public.planning_deal_payments CASCADE;
DROP TABLE IF EXISTS public.planning_deals CASCADE;
