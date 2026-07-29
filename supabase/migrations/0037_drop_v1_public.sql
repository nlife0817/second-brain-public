-- Снос наследия v1: схема public освобождается от таблиц, функций и расписаний
-- персонального «второго мозга». Остаётся только схема core (командный трекер).
--
-- ############################################################################
-- ##  НЕОБРАТИМО. Перед прогоном сделать дамп:  pg_dump -n public ...        ##
-- ############################################################################
--
-- ПОРЯДОК ДЕПЛОЯ. Сначала выкатывается код без обращений к public
-- (коммиты «удалить наследие v1» и «отвязать ядро v2 от схемы public»),
-- только потом эта миграция. В обратном порядке будет 500 на первом входе
-- пользователя и на каждой push-рассылке.
--
-- ЧЕГО ЭТА МИГРАЦИЯ НЕ ДЕЛАЕТ И ПОЧЕМУ:
--   * НЕ трогает `drop schema public` — в public живут объекты v2:
--       - public.v2_cron_tick()      (0027) — тело расписания 'v2_core_tick';
--       - public.rls_auto_enable()   (0006, переопределена 0023) — авто-включение
--         RLS на новых таблицах core через EVENT TRIGGER ensure_rls;
--     снос схемы целиком убил бы весь фон v2. Дропаем только поимённо.
--   * НЕ трогает расширения pg_cron / pg_net: они заведены v1-миграциями
--     0005/0008, а 0027 (v2) делает лишь `create extension if not exists`.
--     DROP EXTENSION молча убьёт cron v2.
--   * НЕ трогает Vault-секреты app_url / cron_secret — их читает v2_cron_tick().
--   * НЕ трогает core.migration_map и core._mig_ts/_mig_date/_mig_time
--     (созданы scripts/migrate-v1-to-v2.sql) — это аудит-след переноса
--     старых id в новые. Дропать отдельным решением.

-- ----------------------------------------------------------------------------
-- 0. ПРЕДПОЛЁТНАЯ ПРОВЕРКА — выполнить ОТДЕЛЬНО и глазами до прогона миграции.
--
-- Авто-провижининг из whitelist v1 (provisionFromWhitelist) удалён из кода:
-- доступ теперь выдаётся только приглашением. Запрос показывает людей, которые
-- после дропа public.users потеряют возможность войти. Если он что-то вернёт —
-- сначала выдать им членство (core.invitations или вручную в core.org_members).
--
--   select u.email, u.role, u.name
--   from public.users u
--   left join core.users cu on cu.email = lower(u.email)
--   left join core.org_members m on m.user_id = cu.id
--   where m.user_id is null;
-- ----------------------------------------------------------------------------

do $$
declare orphaned int;
begin
  select count(*) into orphaned
  from public.users u
  left join core.users cu on cu.email = lower(u.email)
  left join core.org_members m on m.user_id = cu.id
  where m.user_id is null;

  if orphaned > 0 then
    raise warning
      'v1-whitelist: % пользователей без членства в организации потеряют доступ после дропа public.users',
      orphaned;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. Перенос push-подписок public → core.
--
-- Диспетчер v2 больше не читает public.push_subscriptions. Устройства,
-- подписавшиеся до появления core.push_subscriptions (0033), без этого шага
-- молча перестанут получать уведомления до ручной переподписки.
-- Строки без соответствия в core.users переносить некуда — они отпадут вместе
-- с таблицей (это те же люди, что в предупреждении выше).
-- ----------------------------------------------------------------------------

insert into core.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
select cu.id, ps.endpoint, ps.p256dh, ps.auth, ps.user_agent
from public.push_subscriptions ps
join core.users cu on cu.email = lower(ps.user_email)
on conflict (endpoint) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Расписания v1 — снять окончательно.
--
-- Миграция 0034_disable_v1_cron.sql выключила их обратимо (`active := false`),
-- рассчитывая, что код v1 ещё лежит в репозитории. Теперь роутов нет совсем,
-- возвращать нечего — расписания удаляются.
--
-- Список тот же, что в 0034: в боевой базе задач больше, чем заводили файлы
-- миграций 0005/0008 (часть создана вручную), поэтому перечисляем поимённо все
-- десять. Они били по /api/notifications/dispatch, /api/timing/watchdog и
-- /api/cron/planning/* — всё удалено.
--
-- НЕ ТРОГАТЬ 'v2_core_tick' (0027) — это единственный фон v2.
-- ----------------------------------------------------------------------------

do $$
declare j record;
begin
  for j in
    select jobid, jobname from cron.job
    where jobname in (
      'notify-hourly-deadlines',
      'notify-date-only-morning',
      'notify-daily-summary',
      'notif-daily-summary',
      'notif-overdue-hour',
      'notif-date-only-morning',
      'timing-watchdog',
      'planning-recurring-payments',
      'planning-early-warning',
      'planning-support-initiative',
      'planning-pilot-overdue'
    )
  loop
    perform cron.unschedule(j.jobid);
    raise notice 'cron: снято задание %', j.jobname;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Публикация supabase_realtime — страховка.
--
-- Основную работу сделала 0035_drop_v1_from_realtime.sql: она сняла с публикации
-- все таблицы схемы public (их было 39 — больше, чем заводили файлы миграций).
-- Здесь повтор того же цикла на случай, если между 0035 и этим прогоном
-- что-то вернулось в публикацию: Postgres снял бы таблицу и сам при DROP TABLE,
-- но практика репозитория (0021, 0022, 0035) — отцеплять явно, слот репликации
-- Supabase к этому чувствителен. Если возвращать нечего, блок ничего не делает.
--
-- НЕ ТРОГАТЬ таблицы core.* — семь таблиц ядра остаются в публикации.
-- ----------------------------------------------------------------------------

do $$
declare r record;
begin
  for r in
    select tablename from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
  loop
    begin
      execute format('alter publication supabase_realtime drop table public.%I', r.tablename);
      raise notice 'realtime: отцеплена public.%', r.tablename;
    exception when undefined_object or undefined_table then null;
    end;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Таблицы v1. CASCADE снимает FK, индексы и RLS-политики одним махом.
--    Политики 'allowed_users_all' (0002/0006) уходят вместе с таблицами.
-- ----------------------------------------------------------------------------

-- Kaiten и синхронизация (0001)
drop table if exists public.sync_outbox cascade;
drop table if exists public.sync_import_runs cascade;
drop table if exists public.external_entity_links cascade;
drop table if exists public.sync_field_mappings cascade;
drop table if exists public.sync_profiles cascade;
drop table if exists public.integration_settings cascade;

-- Уведомления и push v1 (0004)
drop table if exists public.notifications_log cascade;
drop table if exists public.push_subscriptions cascade;

-- Тайм-трекинг v1 (0007)
drop table if exists public.time_entries cascade;
drop table if exists public.timing_settings cascade;

-- Повторы (0012_recurring_series)
drop table if exists public.recurring_series cascade;

-- Инбокс согласования (0001)
drop table if exists public.staging_items cascade;

-- Связи и комментарии (0001)
drop table if exists public.comments cascade;
drop table if exists public.relations cascade;
drop table if exists public.relation_types cascade;

-- CRM v1 (0001)
drop table if exists public.client_crm_systems cascade;
drop table if exists public.crm_systems cascade;
drop table if exists public.client_links cascade;
drop table if exists public.client_notes cascade;
drop table if exists public.client_contact_fields cascade;
drop table if exists public.client_contacts cascade;
drop table if exists public.client_companies cascade;
drop table if exists public.clients cascade;
drop table if exists public.client_statuses cascade;

-- Недельное планирование (0001)
drop table if exists public.entry_comments cascade;
drop table if exists public.weekly_plan_entries cascade;
drop table if exists public.weekly_plans cascade;

-- Разработка (0001)
drop table if exists public.item_development_participants cascade;
drop table if exists public.development_participants cascade;
drop table if exists public.development_stages cascade;

-- Задачи и справочники (0001, 0009)
drop table if exists public.item_statuses cascade;
drop table if exists public.item_tags cascade;
drop table if exists public.tags cascade;
drop table if exists public.items cascade;
drop table if exists public.categories cascade;

-- Whitelist v1 — последним: на него ссылались FK выше (0001)
drop table if exists public.users cascade;

-- Уже дропнуты в 0021/0022, оставлено для полноты отката
drop table if exists public.client_revenue_entries cascade;
drop table if exists public.goal_metric_snapshots cascade;
drop table if exists public.goal_metric_history cascade;
drop table if exists public.goal_metrics cascade;
drop table if exists public.goals cascade;
drop table if exists public.goal_axes cascade;

-- ----------------------------------------------------------------------------
-- 5. View и функции v1.
--
-- is_allowed_user() дропается CASCADE — от неё зависят политики на
-- storage.objects (см. шаг 6), они снимутся автоматически.
-- ----------------------------------------------------------------------------

drop view if exists public.item_time_self cascade;

drop function if exists public.item_time_total(text, text) cascade;
drop function if exists public.invoke_notifications_dispatch(text) cascade;
drop function if exists public.invoke_timing_watchdog() cascade;
drop function if exists public.is_allowed_user() cascade;
drop function if exists public.sqlite_now() cascade;

-- ----------------------------------------------------------------------------
-- 6. Storage: bucket вложений v1.
--
-- В v2 вложений нет вообще — ни одного обращения к storage в lib/core,
-- api/v2, app/v2, components/v2. Удаление БЕЗВОЗВРАТНО уничтожает файлы,
-- приложенные к задачам v1.
-- ----------------------------------------------------------------------------

drop policy if exists "attachments_read"   on storage.objects;
drop policy if exists "attachments_write"  on storage.objects;
drop policy if exists "attachments_update" on storage.objects;
drop policy if exists "attachments_delete" on storage.objects;

delete from storage.objects where bucket_id = 'attachments';
delete from storage.buckets where id = 'attachments';
