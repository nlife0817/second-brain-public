-- ============================================================================
-- pg_cron для ядра v2: /api/v2/cron делает push-рассылку, материализацию
-- повторяющихся задач и закрытие забытых таймеров.
--
-- Секреты берутся из Vault (как в 0005_notifications_cron.sql):
--   app_url     — базовый URL приложения (без завершающего слэша)
--   cron_secret — то же значение, что в переменной окружения CRON_SECRET
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.v2_cron_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise log 'v2_cron_tick: app_url/cron_secret не заданы в Vault — пропуск';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/api/v2/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke execute on function public.v2_cron_tick() from public, anon, authenticated;

-- Каждые 10 минут: компромисс между свежестью пушей и нагрузкой.
select cron.unschedule('v2_core_tick') where exists (
  select 1 from cron.job where jobname = 'v2_core_tick'
);
select cron.schedule('v2_core_tick', '*/10 * * * *', $$select public.v2_cron_tick();$$);
