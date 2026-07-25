-- ============================================================================
-- Фаза 3: SaaS-готовность — вебхуки, лимиты тарифа, доставка событий наружу.
--
-- Биллинг как таковой (Stripe) не подключается: закладываются entitlements
-- (лимиты плана) и место под план, чтобы включение платежей не меняло схему.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. План и лимиты организации
-- ----------------------------------------------------------------------------
alter table core.organizations
  add column if not exists plan text not null default 'free'
    check (plan in ('free','team','business')),
  add column if not exists entitlements jsonb not null default '{}';

-- ----------------------------------------------------------------------------
-- 2. Вебхуки: подписки и очередь доставки
-- ----------------------------------------------------------------------------
create table core.webhooks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references core.organizations(id) on delete cascade,
  url          text not null,
  secret       text not null,                 -- для подписи HMAC-SHA256
  events       jsonb not null default '[]',   -- ["task.created", …]; [] = все
  enabled      boolean not null default true,
  last_error   text,
  last_sent_at timestamptz,
  created_by   uuid references core.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table core.webhooks enable row level security;
create index idx_core_webhooks_org on core.webhooks (org_id) where enabled;
create trigger set_updated_at before update on core.webhooks
  for each row execute function core.set_updated_at();

create table core.webhook_deliveries (
  id            uuid primary key default gen_random_uuid(),
  webhook_id    uuid not null references core.webhooks(id) on delete cascade,
  event_id      bigint not null references core.events(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts      integer not null default 0,
  next_retry_at timestamptz not null default now(),
  last_error    text,
  created_at    timestamptz not null default now(),
  unique (webhook_id, event_id)
);
alter table core.webhook_deliveries enable row level security;
create index idx_core_webhook_deliveries_due
  on core.webhook_deliveries (next_retry_at) where status = 'pending';

-- ----------------------------------------------------------------------------
-- 3. Постановка событий в очередь доставки — триггером, чтобы ни один
--    доменный сервис не мог «забыть» отправить вебхук.
-- ----------------------------------------------------------------------------
create or replace function core.enqueue_webhooks()
returns trigger
language plpgsql
security definer
set search_path = core, public
as $$
begin
  insert into core.webhook_deliveries (webhook_id, event_id)
  select w.id, new.id
  from core.webhooks w
  where w.org_id = new.org_id
    and w.enabled
    and (jsonb_array_length(w.events) = 0 or w.events ? new.verb)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists events_enqueue_webhooks on core.events;
create trigger events_enqueue_webhooks
  after insert on core.events
  for each row execute function core.enqueue_webhooks();

-- ----------------------------------------------------------------------------
-- 4. Политики: вебхуки и доставки видны только админам организации
-- ----------------------------------------------------------------------------
create or replace function core.is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1 from core.org_members m
    where m.org_id = p_org and m.user_id = core.current_user_id()
      and m.role in ('owner','admin')
  );
$$;

revoke execute on function core.is_org_admin(uuid) from public, anon;
grant execute on function core.is_org_admin(uuid) to authenticated, service_role;

create policy webhooks_select on core.webhooks
  for select to authenticated using (core.is_org_admin(org_id));

create policy webhook_deliveries_select on core.webhook_deliveries
  for select to authenticated using (exists (
    select 1 from core.webhooks w where w.id = webhook_id and core.is_org_admin(w.org_id)
  ));

-- Аудит-лента организации: события целиком видит только админ (0024 давал
-- доступ лишь к событиям видимых задач/проектов — это остаётся для ленты задачи).
drop policy if exists events_select on core.events;
create policy events_select on core.events
  for select to authenticated using (
    core.is_org_admin(org_id)
    or (entity_type = 'task' and core.can_view_task(entity_id))
    or (entity_type = 'project' and core.can_view_project(entity_id))
    or (entity_type = 'client' and core.can_view_clients(org_id))
  );
