-- Drop the 'day' goal level. Day-level goals were used as a separate hierarchy
-- node, but UX showed they add no value over a "tasks-of-week-by-day" projection.
-- The Day column in Miller view becomes a calendar projection of week tasks only.

-- 1. Remove existing day goals (their KR and snapshots cascade via FK).
DELETE FROM public.goals WHERE level = 'day';

-- 2. Tighten the level CHECK back to 4 levels.
ALTER TABLE public.goals DROP CONSTRAINT IF EXISTS goals_level_check;
ALTER TABLE public.goals ADD CONSTRAINT goals_level_check
  CHECK (level IN ('year','quarter','month','week'));
