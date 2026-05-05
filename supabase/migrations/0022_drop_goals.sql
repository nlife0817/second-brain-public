-- Remove the entire Goals feature (migrations 0011-0021).
-- Production data was wiped manually before this migration; CASCADE is safe.
--
-- This drops:
--   - tables: client_revenue_entries, goal_metric_history, goal_metrics,
--     goals, goal_axes (goal_metric_snapshots was already dropped in 0021)
--   - relation_types: 'belongs_to_goal', 'contributes_to_goal'
-- And reverts the CHECK extensions on:
--   - relations.source_type / target_type   → ('item','client')
--   - comments.entity_type                  → ('item','client')

-- ----------------------------------------------------------------------------
-- Realtime: detach goal tables from the publication before drop.
-- Wrapped per-statement in DO blocks so missing entries don't abort the run.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.goals;
EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.goal_metrics;
EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.goal_axes;
EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.goal_metric_history;
EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.client_revenue_entries;
EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Drop tables (CASCADE clears FKs & dependent indexes/policies in one shot).
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.client_revenue_entries CASCADE;
DROP TABLE IF EXISTS public.goal_metric_history    CASCADE;
DROP TABLE IF EXISTS public.goal_metrics           CASCADE;
DROP TABLE IF EXISTS public.goals                  CASCADE;
DROP TABLE IF EXISTS public.goal_axes              CASCADE;

-- ----------------------------------------------------------------------------
-- Remove seeded goal-related relation types.
-- ----------------------------------------------------------------------------
DELETE FROM public.relation_types
 WHERE id IN ('belongs_to_goal', 'contributes_to_goal');

-- ----------------------------------------------------------------------------
-- Revert relations CHECKs from ('item','client','goal') back to ('item','client').
-- Any leftover rows with type='goal' are removed first (defensive — should be
-- none after the table drops above cascade).
-- ----------------------------------------------------------------------------
DELETE FROM public.relations
 WHERE source_type = 'goal' OR target_type = 'goal';

ALTER TABLE public.relations DROP CONSTRAINT IF EXISTS relations_source_type_check;
ALTER TABLE public.relations ADD  CONSTRAINT relations_source_type_check
  CHECK (source_type IN ('item','client'));
ALTER TABLE public.relations DROP CONSTRAINT IF EXISTS relations_target_type_check;
ALTER TABLE public.relations ADD  CONSTRAINT relations_target_type_check
  CHECK (target_type IN ('item','client'));

-- ----------------------------------------------------------------------------
-- Revert comments.entity_type from ('item','client','goal') back to ('item','client').
-- ----------------------------------------------------------------------------
DELETE FROM public.comments WHERE entity_type = 'goal';

ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_entity_type_check;
ALTER TABLE public.comments ADD  CONSTRAINT comments_entity_type_check
  CHECK (entity_type IN ('item','client'));
