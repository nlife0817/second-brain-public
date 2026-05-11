-- ============================================================================
-- 0029: Drop 'kaiten' from planning_metrics.source enum
-- ============================================================================
-- По решению пользователя интеграция с Kaiten как источник факта для метрики
-- больше не поддерживается. Концепт §3.3 содержал такой вариант — изымаем.
-- Существующие данные с source='kaiten' (если есть) — переводятся в 'manual'.
-- ============================================================================

-- 1) Перевести существующие kaiten-метрики в manual
UPDATE public.planning_metrics
  SET source = 'manual'
  WHERE source = 'kaiten';

-- 2) Заменить CHECK-констрейнт
ALTER TABLE public.planning_metrics
  DROP CONSTRAINT IF EXISTS planning_metrics_source_check;

ALTER TABLE public.planning_metrics
  ADD CONSTRAINT planning_metrics_source_check
  CHECK (source IS NULL OR source IN ('grafana', 'second_brain', 'product_analytics', 'manual'));
