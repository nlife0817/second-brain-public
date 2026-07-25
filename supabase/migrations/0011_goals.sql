-- Hierarchical goals (year → quarter → month → week) with OKR-style key results.
-- Goals are linked to tasks (items) via the existing polymorphic relations table,
-- which is extended to accept source_type/target_type = 'goal'.

-- ----------------------------------------------------------------------------
-- Goals
-- ----------------------------------------------------------------------------
CREATE TABLE public.goals (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES public.goals(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('year','quarter','month','week')),
  axis TEXT CHECK (axis IN ('income','debts','project','health')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','paused','dropped')),
  period_start TEXT,
  period_end TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now()
);

CREATE INDEX idx_goals_parent ON public.goals(parent_id);
CREATE INDEX idx_goals_level ON public.goals(level);
CREATE INDEX idx_goals_axis ON public.goals(axis);

-- ----------------------------------------------------------------------------
-- Goal metrics (Key Results). Five kinds:
--   tasks     — auto-counted from linked items via relations
--   numeric   — single value with target (direction up/down, optional start_value)
--   counter   — incremental count toward target
--   checklist — payload.items: [{title, done}]
--   boolean   — payload.done: bool
-- ----------------------------------------------------------------------------
CREATE TABLE public.goal_metrics (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('tasks','numeric','counter','checklist','boolean')),
  title TEXT NOT NULL,
  unit TEXT,
  target_value NUMERIC,
  current_value NUMERIC,
  start_value NUMERIC,
  direction TEXT NOT NULL DEFAULT 'up' CHECK (direction IN ('up','down')),
  payload JSONB,
  weight NUMERIC NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now()
);

CREATE INDEX idx_goal_metrics_goal ON public.goal_metrics(goal_id);

-- ----------------------------------------------------------------------------
-- History of metric values (for sparkline & retrospectives).
-- ----------------------------------------------------------------------------
CREATE TABLE public.goal_metric_snapshots (
  id TEXT PRIMARY KEY,
  metric_id TEXT NOT NULL REFERENCES public.goal_metrics(id) ON DELETE CASCADE,
  value NUMERIC NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT sqlite_now(),
  note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_goal_metric_snapshots_metric ON public.goal_metric_snapshots(metric_id, recorded_at DESC);

-- ----------------------------------------------------------------------------
-- Extend relations CHECK constraints to allow 'goal' as source/target.
-- ----------------------------------------------------------------------------
ALTER TABLE public.relations DROP CONSTRAINT IF EXISTS relations_source_type_check;
ALTER TABLE public.relations ADD CONSTRAINT relations_source_type_check
  CHECK (source_type IN ('item','client','goal'));
ALTER TABLE public.relations DROP CONSTRAINT IF EXISTS relations_target_type_check;
ALTER TABLE public.relations ADD CONSTRAINT relations_target_type_check
  CHECK (target_type IN ('item','client','goal'));

-- Seed the system relation type used to link goals to tasks (and vice versa).
INSERT INTO public.relation_types (id, name, color, icon, position, is_system)
VALUES ('belongs_to_goal', 'Относится к цели', '#8b5cf6', 'Target', 100, 1)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- RLS: re-apply the uniform "allowed_users_all" policy to the new tables
-- (the dynamic block in 0002_rls.sql ran once at install time).
-- ----------------------------------------------------------------------------
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_metric_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allowed_users_all" ON public.goals;
CREATE POLICY "allowed_users_all" ON public.goals
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

DROP POLICY IF EXISTS "allowed_users_all" ON public.goal_metrics;
CREATE POLICY "allowed_users_all" ON public.goal_metrics
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

DROP POLICY IF EXISTS "allowed_users_all" ON public.goal_metric_snapshots;
CREATE POLICY "allowed_users_all" ON public.goal_metric_snapshots
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

-- Realtime: enable for client subscriptions.
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.goals,
  public.goal_metrics,
  public.goal_metric_snapshots;
