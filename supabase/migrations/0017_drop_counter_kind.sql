-- Counter kind has no real use case — incremental counters with a target are
-- adequately covered by `numeric` (direction='up'). Migrate any existing rows
-- and tighten the CHECK constraint.

UPDATE public.goal_metrics SET kind = 'numeric' WHERE kind = 'counter';

ALTER TABLE public.goal_metrics DROP CONSTRAINT IF EXISTS goal_metrics_kind_check;
ALTER TABLE public.goal_metrics ADD CONSTRAINT goal_metrics_kind_check
  CHECK (kind IN ('tasks','numeric','checklist','boolean'));
