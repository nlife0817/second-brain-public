-- ============================================================================
-- Снятие зависимости от pg_cron / pg_net / Vault (переезд на VPS).
--
-- ПРИМЕНЯТЬ ПОСЛЕ pg_restore.
--
-- Расписания теперь ведёт контейнер cron (deploy/cron/crontab): busybox crond
-- дёргает те же HTTP-эндпоинты, а секрет берёт из .env, а не из Supabase Vault.
-- Функции-обёртки восстановятся из дампа как код (plpgsql не проверяет имена
-- объектов при создании) и молча упадут при первом вызове — убираем их, чтобы
-- не осталось мёртвого пути уведомлений.
--
-- Что чем заменено:
--   v2_cron_tick                   → POST /api/v2/cron            каждые 10 мин
--   invoke_notifications_dispatch  → GET  /api/notifications/dispatch  (v1, выкл.)
--   invoke_timing_watchdog         → GET  /api/timing/watchdog        (v1, выкл.)
-- ============================================================================

drop function if exists public.v2_cron_tick();
drop function if exists public.invoke_notifications_dispatch(text);
drop function if exists public.invoke_timing_watchdog();

-- Расписания жили в схеме cron самого расширения; без pg_cron её нет, и
-- unschedule вызывать не по чему. Оставляем проверку на случай, если базу
-- восстанавливали в кластер, где pg_cron всё же установлен.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in (
      'v2_core_tick',
      'notif-overdue-hour',
      'notif-daily-summary',
      'notif-date-only-morning',
      'timing-watchdog',
      'kaiten-sync'
    );
  end if;
end $$;
