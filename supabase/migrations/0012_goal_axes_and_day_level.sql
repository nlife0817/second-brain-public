-- Make goal axes user-managed (table + seed defaults), drop CHECK on goals.axis.
-- Add 'day' to goals.level CHECK (5-th column in Miller view).

-- ----------------------------------------------------------------------------
-- goal_axes table
-- ----------------------------------------------------------------------------
CREATE TABLE public.goal_axes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  bg TEXT NOT NULL DEFAULT '#f1f5f9',
  icon TEXT NOT NULL DEFAULT '◆',
  position INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now()
);

INSERT INTO public.goal_axes (id, name, color, bg, icon, position, is_system) VALUES
  ('income',  'Доход',    '#22c55e', '#dcfce7', '$', 0, 1),
  ('debts',   'Долги',    '#ef4444', '#fee2e2', '!', 1, 1),
  ('project', 'Проект',   '#3b82f6', '#dbeafe', '#', 2, 1),
  ('health',  'Здоровье', '#f97316', '#ffedd5', '+', 3, 1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.goal_axes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allowed_users_all" ON public.goal_axes;
CREATE POLICY "allowed_users_all" ON public.goal_axes
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

ALTER PUBLICATION supabase_realtime ADD TABLE public.goal_axes;

-- ----------------------------------------------------------------------------
-- goals.axis: drop CHECK so axis ids become free-form (managed by goal_axes)
-- ----------------------------------------------------------------------------
ALTER TABLE public.goals DROP CONSTRAINT IF EXISTS goals_axis_check;

-- ----------------------------------------------------------------------------
-- goals.level: add 'day'
-- ----------------------------------------------------------------------------
ALTER TABLE public.goals DROP CONSTRAINT IF EXISTS goals_level_check;
ALTER TABLE public.goals ADD CONSTRAINT goals_level_check
  CHECK (level IN ('year','quarter','month','week','day'));
