-- ============================================================================
-- 0028: Initiative deadline → week range (start..end)
-- ============================================================================
-- Концепт §3.4.1 имел `due_period_id` (одна неделя). По решению пользователя
-- инициатива имеет диапазон недель: `start_period_id..end_period_id`.
-- Последняя дата (end_period.end_date) — дедлайн. Сдвиг диапазона = пере-
-- планирование с replan_reason.
--
-- `due_period_id` оставляем как computed-зеркало end_period_id для обратной
-- совместимости с существующими API (Roadmap, retro pre-fill).
-- ============================================================================

ALTER TABLE public.planning_initiatives
  ADD COLUMN IF NOT EXISTS start_period_id UUID REFERENCES public.planning_periods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS end_period_id UUID REFERENCES public.planning_periods(id) ON DELETE SET NULL;

-- Backfill: при наличии due_period_id — обе ставятся в него (диапазон длины 1)
UPDATE public.planning_initiatives
  SET start_period_id = due_period_id,
      end_period_id = due_period_id
  WHERE due_period_id IS NOT NULL
    AND (start_period_id IS NULL OR end_period_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_planning_initiatives_start_period
  ON public.planning_initiatives (start_period_id)
  WHERE start_period_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planning_initiatives_end_period
  ON public.planning_initiatives (end_period_id)
  WHERE end_period_id IS NOT NULL;

-- Trigger: при update end_period_id → синхронизируем due_period_id (back-compat)
CREATE OR REPLACE FUNCTION public.planning_initiatives_sync_due_period()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.end_period_id IS DISTINCT FROM OLD.end_period_id THEN
    NEW.due_period_id := NEW.end_period_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_planning_initiatives_sync_due_period ON public.planning_initiatives;
CREATE TRIGGER trg_planning_initiatives_sync_due_period
  BEFORE UPDATE ON public.planning_initiatives
  FOR EACH ROW
  EXECUTE FUNCTION public.planning_initiatives_sync_due_period();
