-- 0019_metric_history copied every existing snapshot row into the unified
-- goal_metric_history table and switched all reads/writes to it. The legacy
-- goal_metric_snapshots was kept dormant for one release cycle as a rollback
-- safety net. Production has been stable on the new flow, so the table is now
-- removed.

ALTER PUBLICATION supabase_realtime DROP TABLE public.goal_metric_snapshots;
DROP TABLE IF EXISTS public.goal_metric_snapshots;
