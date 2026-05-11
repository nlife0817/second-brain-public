-- Planning system V3 — reconciliation migration.
-- See IMPLEMENTATION_PLAN.md §1.5 and planning_system_concept.md §3.

-- 1) Drop items.estimate_hours (duplicates items.estimated_minutes from 0007).
ALTER TABLE public.items DROP COLUMN IF EXISTS estimate_hours;

-- 2) Drop items.kaiten_card_id (duplicates external_entity_links).
DROP INDEX IF EXISTS public.idx_items_kaiten_card;
ALTER TABLE public.items DROP COLUMN IF EXISTS kaiten_card_id;

-- 3) Add is_carryover for week->week task carryover marker.
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS is_carryover BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_items_is_carryover
  ON public.items (is_carryover) WHERE is_carryover = TRUE;

-- 4) Drop legacy weekly planning model (replaced by planning_periods type='week').
DROP TABLE IF EXISTS public.entry_comments CASCADE;
DROP TABLE IF EXISTS public.weekly_plan_entries CASCADE;
DROP TABLE IF EXISTS public.weekly_plans CASCADE;

-- 5) Drop dead client_revenue_entries (was tied to removed goals; replaced by planning_deal_payments).
DROP TABLE IF EXISTS public.client_revenue_entries CASCADE;

-- 6) Extend notifications_log.type to allow planning-related alerts.
--    The auto-named CHECK constraint is `notifications_log_type_check` (Postgres default).
ALTER TABLE public.notifications_log
  DROP CONSTRAINT IF EXISTS notifications_log_type_check;
ALTER TABLE public.notifications_log
  ADD CONSTRAINT notifications_log_type_check
  CHECK (type IN (
    'overdue_hour',
    'daily_summary',
    -- legacy type kept so historical notifications_log rows still satisfy the check
    'date_only_morning',
    'planning_early_warning',
    'planning_kill_criteria',
    'planning_capacity_overload'
  ));

-- 7) Seed the 5 semantic task categories required by the planning concept (§3.6).
--    Soft-validated in API; no CHECK constraint on items.category so existing data survives.
INSERT INTO public.categories (id, name, color, icon, position) VALUES
  ('development', 'Разработка', '#3b82f6', 'Code2', 10),
  ('sales',       'Продажи',    '#eab308', 'TrendingUp', 20),
  ('account',     'Аккаунтинг', '#14b8a6', 'BookOpen', 30),
  ('support',     'Поддержка',  '#06b6d4', 'LifeBuoy', 40),
  ('legal',       'Юридическое','#a855f7', 'Scale',    50)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  position = EXCLUDED.position;

-- 8) Make sure the planning_settings singleton exists (defensive — 0023 already inserts it).
INSERT INTO public.planning_settings (id) VALUES ('default')
  ON CONFLICT (id) DO NOTHING;
