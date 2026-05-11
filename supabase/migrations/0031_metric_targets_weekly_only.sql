-- ============================================================================
-- 0031: Metric targets — weekly-only storage + annual_target column
-- ============================================================================
-- По решению пользователя (PLAN_PLANNING_REWORK §0): таргеты хранятся ТОЛЬКО
-- на уровне недель. Quarter / Month / Year — это агрегация SUM из weeks на лету
-- (computed view). Годовая цель — input от пользователя — переезжает в колонку
-- `planning_metrics.annual_target` (раньше хранилась как target_value у
-- period.type='year').
--
-- Пользователь разрешил drop существующих non-week targets (только тестовые
-- данные).
-- ============================================================================

-- 1) Колонка annual_target на метрике (input годовой цели, который user задаёт
--    до distribute).
ALTER TABLE public.planning_metrics
  ADD COLUMN IF NOT EXISTS annual_target NUMERIC;

-- 2) Backfill annual_target из существующих year-target-row (если есть).
UPDATE public.planning_metrics m
SET annual_target = t.target_value
FROM public.planning_metric_targets t
JOIN public.planning_periods p ON p.id = t.period_id
WHERE t.metric_id = m.id
  AND p.type = 'year'
  AND m.annual_target IS NULL;

-- 3) DROP non-week targets (cleanup; тестовые данные разрешено грохнуть).
DELETE FROM public.planning_metric_targets t
USING public.planning_periods p
WHERE p.id = t.period_id
  AND p.type IN ('year', 'quarter', 'month');

-- 4) (Опционально) защита на будущее: триггер запрещает вставку non-week
--    targets. Если потребуется обходить (для тестов) — берём в задание.
CREATE OR REPLACE FUNCTION public.planning_metric_targets_week_only()
RETURNS TRIGGER AS $$
DECLARE
  pt TEXT;
BEGIN
  SELECT type INTO pt FROM public.planning_periods WHERE id = NEW.period_id;
  IF pt IS NULL THEN
    -- period не найден — пропускаем (FK сам отвергнет)
    RETURN NEW;
  END IF;
  IF pt <> 'week' THEN
    RAISE EXCEPTION 'planning_metric_targets: only week-level targets are allowed (got period.type=%)', pt
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS planning_metric_targets_week_only_trg ON public.planning_metric_targets;
CREATE TRIGGER planning_metric_targets_week_only_trg
  BEFORE INSERT OR UPDATE ON public.planning_metric_targets
  FOR EACH ROW
  EXECUTE FUNCTION public.planning_metric_targets_week_only();
