-- Replace goal_metric_snapshots with a unified history table that captures all
-- mutations on a KR: numeric snapshots, target changes, manual postfactum
-- edits. The UI can edit/delete any entry; deleting recomputes effective
-- current.

CREATE TABLE IF NOT EXISTS public.goal_metric_history (
  id TEXT PRIMARY KEY,
  metric_id TEXT NOT NULL REFERENCES public.goal_metrics(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('snapshot','target_change','manual_edit')),
  value NUMERIC,
  prev_value NUMERIC,
  payload JSONB,
  recorded_at TEXT NOT NULL DEFAULT sqlite_now(),
  note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_goal_metric_history_metric
  ON public.goal_metric_history(metric_id, recorded_at DESC);

-- Migrate existing snapshots into the unified table.
INSERT INTO public.goal_metric_history (id, metric_id, event_type, value, recorded_at, note)
  SELECT id, metric_id, 'snapshot', value, recorded_at, COALESCE(note, '')
    FROM public.goal_metric_snapshots
ON CONFLICT (id) DO NOTHING;

-- Realtime + RLS, then drop the old table.
ALTER TABLE public.goal_metric_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allowed_users_all" ON public.goal_metric_history;
CREATE POLICY "allowed_users_all" ON public.goal_metric_history
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

ALTER PUBLICATION supabase_realtime ADD TABLE public.goal_metric_history;

-- The old goal_metric_snapshots table is left dormant for one release cycle so
-- a rollback is possible. Drop it in a follow-up migration once the new
-- history flow is verified in production.
