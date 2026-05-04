-- KR inheritance between goal levels.
--
-- Hybrid OKR model: target_value is set top-down (manually planned per level),
-- current_value is aggregated bottom-up (sum/union/AND of children) when there
-- are linked child KRs. parent_metric_id forms the explicit link.
--
-- For kind='tasks' KRs we add two more columns:
--   tasks_mode='manual' (default) — current behavior, tasks linked via relations.
--   tasks_mode='auto'             — done/total counted from items by category +
--                                   the parent goal's period_start..period_end.

ALTER TABLE public.goal_metrics
  ADD COLUMN IF NOT EXISTS parent_metric_id TEXT
    REFERENCES public.goal_metrics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tasks_mode TEXT
    CHECK (tasks_mode IN ('auto','manual')) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS tasks_category_ids TEXT[];

CREATE INDEX IF NOT EXISTS idx_metrics_parent
  ON public.goal_metrics(parent_metric_id);
