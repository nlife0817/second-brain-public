-- Удаляем cron-расписание notif-date-only-morning.
-- Уведомления для задач с датой, но без точного времени, больше не отправляем.
-- Push'и теперь только: за час до дедлайна (overdue_hour) и вечерняя сводка (daily_summary).

DO $$
DECLARE
  j RECORD;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'notif-date-only-morning'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;
