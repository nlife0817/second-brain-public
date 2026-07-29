-- Выключение cron-задач v1.
--
-- v1 отключён: proxy уводит его страницы в v2, а /api/* вне /api/v2/* отвечает
-- 410. Роуты cron исключены из proxy по построению (их дёргает pg_net без
-- сессии), поэтому остановить их можно только здесь.
--
-- Задачи били по /api/notifications/dispatch, /api/timing/watchdog и
-- /api/cron/planning/* — все читают схему public (таблицу items) и шлют push по
-- whitelist v1. Две пары к тому же дублировали друг друга: overdue_hour
-- запускался и ежечасно (notify-hourly-deadlines), и каждые 15 минут
-- (notif-overdue-hour); daily_summary — двумя задачами в одно и то же время.
--
-- v2_core_tick НЕ трогаем: это единственная задача v2 (/api/v2/cron).
--
-- Выключаем, а не удаляем (cron.unschedule): расписания остаются на месте, и
-- обратный ход — тот же вызов с active := true.

do $$
declare
  v_name text;
  v_id bigint;
  v_names text[] := array[
    'notify-hourly-deadlines',
    'notify-date-only-morning',
    'notify-daily-summary',
    'notif-daily-summary',
    'notif-overdue-hour',
    'timing-watchdog',
    'planning-recurring-payments',
    'planning-early-warning',
    'planning-support-initiative',
    'planning-pilot-overdue'
  ];
begin
  foreach v_name in array v_names loop
    select jobid into v_id from cron.job where jobname = v_name;
    if v_id is null then
      raise notice 'cron-задача % не найдена — пропуск', v_name;
      continue;
    end if;
    perform cron.alter_job(v_id, active := false);
    raise notice 'cron-задача % выключена', v_name;
  end loop;
end $$;
