-- Planning system (V3 Released) — initial schema.
-- See planning_system_concept.md §3 (object model) and IMPLEMENTATION_PLAN.md Phase 1.
--
-- Conventions adopted from this codebase:
--   * single-tenant whitelist auth (public.is_allowed_user()); no per-row user_id.
--   * UUID PKs with gen_random_uuid() (see 0012_recurring_series.sql).
--   * Event trigger from 0006 enables RLS automatically; we add the
--     "allowed_users_all" policy explicitly per table.
--   * Tasks live in public.items (type='task'); we ALTER items to add planning
--     fields instead of touching a non-existent `tasks` table.

-- ============================================================================
-- 1. Directions (Domain)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_directions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  year_focus TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. Periods (year / quarter / month / week)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID REFERENCES public.planning_directions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('year','quarter','month','week')),
  year INT NOT NULL,
  quarter_n INT CHECK (quarter_n BETWEEN 1 AND 4),
  month_n INT CHECK (month_n BETWEEN 1 AND 12),
  week_n INT CHECK (week_n BETWEEN 1 AND 53),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  metric_targets_snapshot JSONB,
  capacity_hours NUMERIC,
  retrospective JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_planning_periods_slot
  ON public.planning_periods (direction_id, type, year,
    COALESCE(quarter_n, 0), COALESCE(month_n, 0), COALESCE(week_n, 0));
CREATE INDEX IF NOT EXISTS idx_planning_periods_dates
  ON public.planning_periods (direction_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_planning_periods_type_year
  ON public.planning_periods (type, year);

-- ============================================================================
-- 3. Metrics
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID REFERENCES public.planning_directions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('numeric','business','delivery')),
  unit TEXT,
  direction_value TEXT CHECK (direction_value IN ('up','down')),
  baseline NUMERIC,
  source TEXT CHECK (source IN ('kaiten','grafana','second_brain','product_analytics','manual')),
  source_id TEXT,
  is_cumulative BOOLEAN NOT NULL DEFAULT TRUE,
  is_emergent BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planning_metrics_direction
  ON public.planning_metrics (direction_id);

-- ============================================================================
-- 4. Metric targets per horizon
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_metric_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id UUID NOT NULL REFERENCES public.planning_metrics(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES public.planning_periods(id) ON DELETE CASCADE,
  target_value NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (metric_id, period_id)
);
CREATE INDEX IF NOT EXISTS idx_planning_metric_targets_metric
  ON public.planning_metric_targets (metric_id);
CREATE INDEX IF NOT EXISTS idx_planning_metric_targets_period
  ON public.planning_metric_targets (period_id);

-- ============================================================================
-- 5. Metric ticks (numeric fact history)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_metric_ticks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id UUID NOT NULL REFERENCES public.planning_metrics(id) ON DELETE CASCADE,
  value NUMERIC NOT NULL,
  measured_at TIMESTAMPTZ NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_planning_metric_ticks_metric_time
  ON public.planning_metric_ticks (metric_id, measured_at DESC);

-- ============================================================================
-- 6. Initiatives
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_initiatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID REFERENCES public.planning_directions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('client_blocker','product_maturity','tech_debt','experiment','support')),
  description TEXT,
  jtbd TEXT,
  due_period_id UUID REFERENCES public.planning_periods(id) ON DELETE SET NULL,
  estimate_hours NUMERIC,
  rice_reach NUMERIC,
  rice_impact NUMERIC CHECK (rice_impact IN (0.25, 0.5, 1, 2, 3)),
  rice_confidence NUMERIC CHECK (rice_confidence IN (0.5, 0.8, 1.0)),
  rice_score NUMERIC GENERATED ALWAYS AS (
    CASE WHEN COALESCE(estimate_hours, 0) > 0
      THEN (COALESCE(rice_reach, 0) * COALESCE(rice_impact, 0) * COALESCE(rice_confidence, 0)) / (estimate_hours / 40.0)
      ELSE 0
    END
  ) STORED,
  key_assumptions TEXT[],
  kill_criteria TEXT,
  parent_initiative_id UUID REFERENCES public.planning_initiatives(id) ON DELETE SET NULL,
  created_from_task_id TEXT,
  hypothesis TEXT,
  success_criteria TEXT,
  sample_size_or_duration TEXT,
  experiment_result TEXT,
  experiment_decision TEXT CHECK (experiment_decision IN ('validated','invalidated','inconclusive')),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','done','killed')),
  done_at TIMESTAMPTZ,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_planning_initiatives_direction ON public.planning_initiatives (direction_id);
CREATE INDEX IF NOT EXISTS idx_planning_initiatives_due ON public.planning_initiatives (due_period_id);
CREATE INDEX IF NOT EXISTS idx_planning_initiatives_status_open
  ON public.planning_initiatives (status) WHERE status != 'done';
CREATE INDEX IF NOT EXISTS idx_planning_initiatives_parent
  ON public.planning_initiatives (parent_initiative_id)
  WHERE parent_initiative_id IS NOT NULL;

-- ============================================================================
-- 7. Initiative ↔ Metric (M:N)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_initiative_metric_link (
  initiative_id UUID NOT NULL REFERENCES public.planning_initiatives(id) ON DELETE CASCADE,
  metric_id UUID NOT NULL REFERENCES public.planning_metrics(id) ON DELETE CASCADE,
  PRIMARY KEY (initiative_id, metric_id)
);
CREATE INDEX IF NOT EXISTS idx_iml_metric ON public.planning_initiative_metric_link (metric_id);

-- ============================================================================
-- 8. Deals
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
  icp_segment_id UUID,
  stage TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead','pilot','production','churned')),
  stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pilot_started_at TIMESTAMPTZ,
  pilot_default_duration_days INT DEFAULT 60,
  pilot_planned_end_at TIMESTAMPTZ,
  pilot_ended_at TIMESTAMPTZ,
  production_started_at TIMESTAMPTZ,
  min_monthly_amount NUMERIC,
  expected_actual_amount NUMERIC,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_planning_deals_stage ON public.planning_deals (stage);
CREATE INDEX IF NOT EXISTS idx_planning_deals_client ON public.planning_deals (client_id);

-- ============================================================================
-- 9. Deal payments
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_deal_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.planning_deals(id) ON DELETE CASCADE,
  paid_at DATE NOT NULL,
  amount NUMERIC NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'expected' CHECK (status IN ('expected','confirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_planning_deal_payments_deal ON public.planning_deal_payments (deal_id);
CREATE INDEX IF NOT EXISTS idx_planning_deal_payments_date ON public.planning_deal_payments (paid_at);

-- ============================================================================
-- 10. Initiative ↔ Deal (M:N with blocks_stage)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_initiative_deal_link (
  initiative_id UUID NOT NULL REFERENCES public.planning_initiatives(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.planning_deals(id) ON DELETE CASCADE,
  blocks_stage TEXT CHECK (blocks_stage IN ('pilot','production')),
  PRIMARY KEY (initiative_id, deal_id)
);
CREATE INDEX IF NOT EXISTS idx_idl_deal ON public.planning_initiative_deal_link (deal_id);

-- ============================================================================
-- 11. Initiative ↔ Client (M:N — existing clients affected)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_initiative_client_link (
  initiative_id UUID NOT NULL REFERENCES public.planning_initiatives(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  PRIMARY KEY (initiative_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_icl_client ON public.planning_initiative_client_link (client_id);

-- ============================================================================
-- 12. Initiative dependencies
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_initiative_dependency (
  initiative_id UUID NOT NULL REFERENCES public.planning_initiatives(id) ON DELETE CASCADE,
  depends_on_initiative_id UUID NOT NULL REFERENCES public.planning_initiatives(id) ON DELETE CASCADE,
  PRIMARY KEY (initiative_id, depends_on_initiative_id),
  CHECK (initiative_id != depends_on_initiative_id)
);

-- ============================================================================
-- 13. Period ↔ Initiative (planned for period)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_period_initiative_link (
  period_id UUID NOT NULL REFERENCES public.planning_periods(id) ON DELETE CASCADE,
  initiative_id UUID NOT NULL REFERENCES public.planning_initiatives(id) ON DELETE CASCADE,
  PRIMARY KEY (period_id, initiative_id)
);

-- ============================================================================
-- 14. Change log
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_email TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  diff JSONB,
  replan_reason JSONB,
  context JSONB
);
CREATE INDEX IF NOT EXISTS idx_planning_change_log_entity
  ON public.planning_change_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_planning_change_log_time
  ON public.planning_change_log (timestamp DESC);

-- ============================================================================
-- 15. Settings (singleton row — single-tenant model)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_settings (
  id TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  pilot_default_duration_days INT NOT NULL DEFAULT 60,
  early_warning_weeks INT NOT NULL DEFAULT 4,
  strategy_support_ratio NUMERIC NOT NULL DEFAULT 0.7,
  minor_adjustment_threshold NUMERIC NOT NULL DEFAULT 0.05,
  daily_capacity_hours NUMERIC NOT NULL DEFAULT 8,
  weekly_capacity_hours NUMERIC NOT NULL DEFAULT 40,
  accent_color TEXT NOT NULL DEFAULT '#2563eb',
  weekend_days_visible BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.planning_settings (id) VALUES ('default')
  ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 16. Dictionaries
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.planning_icp_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.planning_replan_reasons (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  requires_text BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO public.planning_replan_reasons (code, title, requires_text) VALUES
  ('customer_signal_changed', 'Сигнал клиентов изменился', false),
  ('discovery_invalidated', 'Гипотеза опровергнута', false),
  ('dependency_shifted', 'Внешняя зависимость сдвинулась', false),
  ('scope_underestimated', 'Объём недооценён', false),
  ('scope_overestimated', 'Объём переоценён', false),
  ('priority_changed', 'Приоритет изменился', true),
  ('external_event', 'Внешнее событие', false),
  ('kill_criteria_triggered', 'Сработал kill criteria', false),
  ('minor_adjustment', 'Минорная правка', false)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.planning_metric_units (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO public.planning_metric_units (code, title, is_default) VALUES
  ('ms', 'ms', true),
  ('sec', 'sec', false),
  ('rub', '₽', true),
  ('usd', '$', false),
  ('count', 'шт', true),
  ('percent', '%', true),
  ('rps', 'rps', false),
  ('gb', 'GB', false),
  ('mb', 'MB', false)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.planning_kaiten_board_mapping (
  kaiten_board_id TEXT PRIMARY KEY,
  initiative_id UUID NOT NULL REFERENCES public.planning_initiatives(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_planning_kaiten_board_mapping_initiative
  ON public.planning_kaiten_board_mapping (initiative_id);

-- ============================================================================
-- 17. Extend items (acting as tasks) with planning fields
-- ============================================================================
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS initiative_id UUID REFERENCES public.planning_initiatives(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_deal_id UUID REFERENCES public.planning_deals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS planned_period_id UUID REFERENCES public.planning_periods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS planned_date DATE,
  ADD COLUMN IF NOT EXISTS estimate_hours NUMERIC,
  ADD COLUMN IF NOT EXISTS why TEXT,
  ADD COLUMN IF NOT EXISTS replan_reason JSONB,
  ADD COLUMN IF NOT EXISTS kaiten_card_id TEXT;

CREATE INDEX IF NOT EXISTS idx_items_initiative_id
  ON public.items (initiative_id) WHERE initiative_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_planned_date
  ON public.items (planned_date) WHERE planned_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_planned_period
  ON public.items (planned_period_id) WHERE planned_period_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_linked_deal
  ON public.items (linked_deal_id) WHERE linked_deal_id IS NOT NULL;

-- ============================================================================
-- 18. RLS policies (allowed_users_all on every new planning_* table)
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'planning_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "allowed_users_all" ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY "allowed_users_all" ON public.%I
         FOR ALL TO authenticated
         USING (public.is_allowed_user())
         WITH CHECK (public.is_allowed_user());', t);
  END LOOP;
END $$;

-- ============================================================================
-- 19. Realtime publication for user-facing tables
-- ============================================================================
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE
    public.planning_directions,
    public.planning_periods,
    public.planning_metrics,
    public.planning_metric_targets,
    public.planning_metric_ticks,
    public.planning_initiatives,
    public.planning_initiative_metric_link,
    public.planning_initiative_deal_link,
    public.planning_initiative_client_link,
    public.planning_initiative_dependency,
    public.planning_period_initiative_link,
    public.planning_deals,
    public.planning_deal_payments,
    public.planning_change_log,
    public.planning_settings,
    public.planning_icp_segments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
