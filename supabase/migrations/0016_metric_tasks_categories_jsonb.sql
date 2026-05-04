-- tasks_category_ids was added as TEXT[] in 0015 but the app's prepare() helper
-- in src/lib/sql.ts auto-flattens JS arrays into multiple placeholders, which
-- breaks INSERT/UPDATE of array params. Switch to JSONB (matches the existing
-- `payload` field convention: JSON-encoded on the way in, parsed on read).
-- The column has no production data yet (just shipped), so the conversion is safe.

ALTER TABLE public.goal_metrics DROP COLUMN IF EXISTS tasks_category_ids;
ALTER TABLE public.goal_metrics ADD COLUMN tasks_category_ids JSONB;
