-- ============================================================================
-- 0032: Deprecate planning_initiative_dependency
-- ============================================================================
-- Зависимости инициатив удалены из системы (PLAN_PLANNING_REWORK §0).
-- UI убран в P0. Cron cascade-warning убран в P6. DB helpers сделаны no-op.
-- API endpoint возвращает 410 Gone.
--
-- Полный DROP TABLE откладывается: на удалённой БД он трактуется как
-- блокирующая операция и таймаутится за 10 сек (lock contention с
-- realtime/replication slot). Когда потребуется — выполнить вручную в SQL
-- editor с предварительным `ALTER PUBLICATION supabase_realtime DROP TABLE
-- public.planning_initiative_dependency;` (уже сделано) и при необходимости
-- остановить кронджобы.
--
-- Пока что таблица остаётся пустой (новые записи не создаются) — она не
-- мешает, но и не используется.
-- ============================================================================

-- Сделаем таблицу неинтересной для realtime (если ещё в публикации):
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.planning_initiative_dependency;
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;

-- DROP TABLE откладываем (см. примечание выше):
-- DROP TABLE IF EXISTS public.planning_initiative_dependency CASCADE;
