-- ============================================================================
-- v2 core foundation: schema `core` — identity, organizations, memberships,
-- invitations, teams (задел). Мультитенантное ядро командного трекера.
--
-- Конвенции core (отличаются от public-наследия SQLite):
--   * uuid PK (gen_random_uuid), timestamptz, никаких TEXT-дат
--   * email — атрибут (всегда lowercased на границе), не идентичность
--   * каждая доменная таблица несёт org_id; композитные индексы с org_id первым
--   * RLS включён на всём; политики только SELECT (API пишет сервисным
--     подключением от владельца таблиц, Realtime читает под authenticated)
-- ============================================================================

create schema if not exists core;

-- ----------------------------------------------------------------------------
-- 1. rls_auto_enable из 0006 знал только про public — расширяем на core,
--    чтобы ни одна будущая core-таблица не уехала без RLS.
-- ----------------------------------------------------------------------------
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table','partitioned table')
  loop
    if cmd.schema_name in ('public', 'core') then
      begin
        execute format('ALTER TABLE IF EXISTS %s ENABLE ROW LEVEL SECURITY', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception when others then
        raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Общий триггер updated_at
-- ----------------------------------------------------------------------------
create or replace function core.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Идентичность и организации
-- ----------------------------------------------------------------------------
create table core.users (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique,               -- auth.users(id); null до первого входа
  email         text not null unique,      -- всегда lowercase
  name          text not null default '',
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table core.users enable row level security;
create trigger set_updated_at before update on core.users
  for each row execute function core.set_updated_at();

create table core.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  settings    jsonb not null default '{}',
  created_by  uuid references core.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table core.organizations enable row level security;
create trigger set_updated_at before update on core.organizations
  for each row execute function core.set_updated_at();

create type core.org_role as enum ('owner','admin','member','guest');
create type core.project_role as enum ('admin','editor','commenter','viewer');

create table core.org_members (
  org_id      uuid not null references core.organizations(id) on delete cascade,
  user_id     uuid not null references core.users(id) on delete cascade,
  role        core.org_role not null default 'member',
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
alter table core.org_members enable row level security;
create index idx_core_org_members_user on core.org_members (user_id);

create table core.invitations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references core.organizations(id) on delete cascade,
  email          text not null,             -- lowercase
  org_role       core.org_role not null default 'member',
  project_grants jsonb not null default '[]',  -- [{project_id, role}] — доступы гостя
  token_hash     text not null unique,      -- sha256(token); сырой токен виден один раз
  invited_by     uuid references core.users(id) on delete set null,
  expires_at     timestamptz not null,
  accepted_at    timestamptz,
  accepted_by    uuid references core.users(id) on delete set null,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now()
);
alter table core.invitations enable row level security;
create index idx_core_invitations_org on core.invitations (org_id, created_at desc);
create index idx_core_invitations_email on core.invitations (email);

-- Задел под фазу 3+: в UI пока не используется
create table core.teams (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references core.organizations(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);
alter table core.teams enable row level security;
create index idx_core_teams_org on core.teams (org_id);

-- ----------------------------------------------------------------------------
-- 4. RLS-хелперы (SECURITY DEFINER: обходят RLS внутри себя — нет рекурсии
--    политик; владелец postgres). Используются политиками и Realtime.
-- ----------------------------------------------------------------------------
create or replace function core.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = core, public
as $$
  select id from core.users where auth_user_id = auth.uid();
$$;

create or replace function core.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1 from core.org_members m
    where m.org_id = p_org and m.user_id = core.current_user_id()
  );
$$;

create or replace function core.shares_org_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
    from core.org_members mine
    join core.org_members theirs on theirs.org_id = mine.org_id
    where mine.user_id = core.current_user_id()
      and theirs.user_id = p_user
  );
$$;

revoke execute on function core.current_user_id() from public, anon;
revoke execute on function core.is_org_member(uuid) from public, anon;
revoke execute on function core.shares_org_with(uuid) from public, anon;
grant execute on function core.current_user_id() to authenticated, service_role;
grant execute on function core.is_org_member(uuid) to authenticated, service_role;
grant execute on function core.shares_org_with(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Гранты и политики. PostgREST схему core не экспонирует; SELECT нужен
--    для Realtime (authenticated) поверх RLS. Записи — только сервисный слой.
-- ----------------------------------------------------------------------------
grant usage on schema core to authenticated, service_role;
grant select on all tables in schema core to authenticated;
grant all on all tables in schema core to service_role;
alter default privileges in schema core grant select on tables to authenticated;
alter default privileges in schema core grant all on tables to service_role;

create policy users_select on core.users
  for select to authenticated
  using (auth_user_id = (select auth.uid()) or core.shares_org_with(id));

create policy organizations_select on core.organizations
  for select to authenticated
  using (core.is_org_member(id));

create policy org_members_select on core.org_members
  for select to authenticated
  using (core.is_org_member(org_id));

create policy teams_select on core.teams
  for select to authenticated
  using (core.is_org_member(org_id));

-- invitations: политик нет — deny-all для authenticated (только через API).

-- ----------------------------------------------------------------------------
-- 6. Бутстрап: единственная организация из текущего whitelist public.users.
--    Идемпотентно: если организации уже есть — ничего не делаем.
--    Маппинг ролей v1→v2: первый admin → owner, остальные admin → admin,
--    manager → member.
-- ----------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_first_owner uuid;
  v_uid uuid;
  v_auth uuid;
  r record;
begin
  if exists (select 1 from core.organizations) then
    return;
  end if;

  for r in select email, role, name, created_at from public.users order by created_at, email loop
    select id into v_auth from auth.users where lower(email) = lower(r.email) limit 1;
    insert into core.users (auth_user_id, email, name)
    values (v_auth, lower(r.email), coalesce(r.name, ''))
    on conflict (email) do nothing;
  end loop;

  if not exists (select 1 from core.users) then
    return; -- пустая установка: org создастся при первом входе через API
  end if;

  insert into core.organizations (name, slug)
  values ('Second Brain', 'second-brain')
  returning id into v_org;

  for r in select email, role, created_at from public.users order by created_at, email loop
    select id into v_uid from core.users where email = lower(r.email);
    if v_uid is null then
      continue;
    end if;
    if r.role = 'admin' and v_first_owner is null then
      v_first_owner := v_uid;
      insert into core.org_members (org_id, user_id, role)
      values (v_org, v_uid, 'owner')
      on conflict do nothing;
    else
      insert into core.org_members (org_id, user_id, role)
      values (v_org, v_uid, case when r.role = 'admin' then 'admin'::core.org_role else 'member'::core.org_role end)
      on conflict do nothing;
    end if;
  end loop;

  update core.organizations set created_by = v_first_owner where id = v_org;
end;
$$;
