-- Tasks KR is always auto: a task is included via due_date inside the goal
-- period AND category_id ∈ tasks_category_ids. Manual relations are no longer
-- used for tasks-KR attachment, so the mode toggle is removed.

ALTER TABLE public.goal_metrics DROP COLUMN IF EXISTS tasks_mode;
