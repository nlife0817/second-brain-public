-- ============================================================================
-- Фаза 2: CRM-клиенты, тайм-трекинг, связи и полнотекстовый поиск в ядре v2.
--
-- Клиенты — first-class сущность организации (не «проект с полями»): контакты,
-- компании, заметки, ссылки, CRM-системы, выручка. Гостям CRM недоступен
-- (policy: clients.view = member+), поэтому RLS требует не-guest членства.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Клиенты
-- ----------------------------------------------------------------------------
create table core.client_statuses (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references core.organizations(id) on delete cascade,
  name      text not null,
  color     text not null default '#6b7280',
  position  double precision not null default 0
);
alter table core.client_statuses enable row level security;
create index idx_core_client_statuses_org on core.client_statuses (org_id, position);

create table core.crm_systems (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references core.organizations(id) on delete cascade,
  name      text not null,
  position  double precision not null default 0,
  unique (org_id, name)
);
alter table core.crm_systems enable row level security;

create table core.clients (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references core.organizations(id) on delete cascade,
  name                text not null default '',
  status_id           uuid references core.client_statuses(id) on delete set null,
  budget              text not null default '',
  operators_per_shift text not null default '',
  operators_total     text not null default '',
  calls_per_month     text not null default '',
  monthly_revenue     numeric,
  position            double precision not null default 0,
  created_by          uuid references core.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table core.clients enable row level security;
create index idx_core_clients_org on core.clients (org_id, position);
create index idx_core_clients_status on core.clients (status_id);
create trigger set_updated_at before update on core.clients
  for each row execute function core.set_updated_at();

create table core.client_companies (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references core.clients(id) on delete cascade,
  name       text not null default ''
);
alter table core.client_companies enable row level security;
create index idx_core_client_companies on core.client_companies (client_id);

create table core.client_contacts (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references core.clients(id) on delete cascade,
  name       text not null default '',
  position   double precision not null default 0
);
alter table core.client_contacts enable row level security;
create index idx_core_client_contacts on core.client_contacts (client_id, position);

create table core.client_contact_fields (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references core.client_contacts(id) on delete cascade,
  type        text not null default 'email' check (type in ('email','phone','telegram','note')),
  value       text not null default ''
);
alter table core.client_contact_fields enable row level security;
create index idx_core_client_contact_fields on core.client_contact_fields (contact_id);

create table core.client_notes (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references core.clients(id) on delete cascade,
  author_id  uuid references core.users(id) on delete set null,
  text       text not null default '',
  created_at timestamptz not null default now()
);
alter table core.client_notes enable row level security;
create index idx_core_client_notes on core.client_notes (client_id, created_at desc);

create table core.client_links (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references core.clients(id) on delete cascade,
  url        text not null default '',
  title      text not null default ''
);
alter table core.client_links enable row level security;
create index idx_core_client_links on core.client_links (client_id);

create table core.client_crm_systems (
  client_id      uuid not null references core.clients(id) on delete cascade,
  crm_system_id  uuid not null references core.crm_systems(id) on delete cascade,
  primary key (client_id, crm_system_id)
);
alter table core.client_crm_systems enable row level security;
create index idx_core_client_crm_systems_crm on core.client_crm_systems (crm_system_id);

-- ----------------------------------------------------------------------------
-- 2. Связи между сущностями (задача ↔ клиент ↔ проект)
-- ----------------------------------------------------------------------------
create table core.relation_types (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references core.organizations(id) on delete cascade,
  name      text not null,
  color     text not null default '#6b7280',
  icon      text not null default 'Link',
  position  double precision not null default 0,
  unique (org_id, name)
);
alter table core.relation_types enable row level security;

create table core.relations (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references core.organizations(id) on delete cascade,
  source_type       text not null check (source_type in ('task','client','project')),
  source_id         uuid not null,
  target_type       text not null check (target_type in ('task','client','project')),
  target_id         uuid not null,
  relation_type_id  uuid references core.relation_types(id) on delete set null,
  created_by        uuid references core.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (source_type, source_id, target_type, target_id)
);
alter table core.relations enable row level security;
create index idx_core_relations_source on core.relations (source_type, source_id);
create index idx_core_relations_target on core.relations (target_type, target_id);

-- ----------------------------------------------------------------------------
-- 3. Тайм-трекинг (без ставок и биллинга — только учёт времени)
-- ----------------------------------------------------------------------------
create table core.time_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references core.organizations(id) on delete cascade,
  user_id     uuid not null references core.users(id) on delete cascade,
  task_id     uuid references core.tasks(id) on delete set null,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,                 -- null = таймер идёт
  seconds     integer,                     -- материализуется при остановке
  source      text not null default 'timer' check (source in ('timer','manual')),
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
alter table core.time_entries enable row level security;
create index idx_core_time_entries_user on core.time_entries (org_id, user_id, started_at desc);
create index idx_core_time_entries_task on core.time_entries (task_id);
-- Один идущий таймер на пользователя — инвариант на уровне БД вместо машинерии в коде.
create unique index idx_core_time_entries_running on core.time_entries (user_id) where ended_at is null;
create trigger set_updated_at before update on core.time_entries
  for each row execute function core.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Поиск: триграммы по названиям задач и клиентов
-- ----------------------------------------------------------------------------
create extension if not exists pg_trgm;
create index idx_core_tasks_title_trgm on core.tasks using gin (title gin_trgm_ops);
create index idx_core_clients_name_trgm on core.clients using gin (name gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 5. Повторяющиеся задачи (шаблон + правило, материализация по cron/визиту)
-- ----------------------------------------------------------------------------
create table core.recurring_rules (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references core.organizations(id) on delete cascade,
  template      jsonb not null default '{}',  -- title, description, priority, status_id, placements, assignees
  freq          text not null check (freq in ('daily','weekdays','weekly','monthly')),
  interval      integer not null default 1 check (interval between 1 and 365),
  byweekday     jsonb,                        -- [1,3,5] для weekly
  bymonthday    integer,                      -- 1..28 для monthly
  start_date    date not null,
  until_date    date,
  next_run_date date not null,
  last_task_id  uuid references core.tasks(id) on delete set null,
  created_by    uuid references core.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table core.recurring_rules enable row level security;
create index idx_core_recurring_due on core.recurring_rules (org_id, next_run_date);
create trigger set_updated_at before update on core.recurring_rules
  for each row execute function core.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. Хелпер видимости клиентов + RLS-политики
-- ----------------------------------------------------------------------------
create or replace function core.can_view_clients(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1 from core.org_members m
    where m.org_id = p_org and m.user_id = core.current_user_id()
      and m.role in ('owner','admin','member')   -- гостям CRM закрыт
  );
$$;

revoke execute on function core.can_view_clients(uuid) from public, anon;
grant execute on function core.can_view_clients(uuid) to authenticated, service_role;

create policy client_statuses_select on core.client_statuses
  for select to authenticated using (core.can_view_clients(org_id));
create policy crm_systems_select on core.crm_systems
  for select to authenticated using (core.can_view_clients(org_id));
create policy clients_select on core.clients
  for select to authenticated using (core.can_view_clients(org_id));
create policy relation_types_select on core.relation_types
  for select to authenticated using (core.is_org_member(org_id));

create policy client_companies_select on core.client_companies
  for select to authenticated using (exists (
    select 1 from core.clients c where c.id = client_id and core.can_view_clients(c.org_id)));
create policy client_contacts_select on core.client_contacts
  for select to authenticated using (exists (
    select 1 from core.clients c where c.id = client_id and core.can_view_clients(c.org_id)));
create policy client_contact_fields_select on core.client_contact_fields
  for select to authenticated using (exists (
    select 1 from core.client_contacts ct join core.clients c on c.id = ct.client_id
    where ct.id = contact_id and core.can_view_clients(c.org_id)));
create policy client_notes_select on core.client_notes
  for select to authenticated using (exists (
    select 1 from core.clients c where c.id = client_id and core.can_view_clients(c.org_id)));
create policy client_links_select on core.client_links
  for select to authenticated using (exists (
    select 1 from core.clients c where c.id = client_id and core.can_view_clients(c.org_id)));
create policy client_crm_systems_select on core.client_crm_systems
  for select to authenticated using (exists (
    select 1 from core.clients c where c.id = client_id and core.can_view_clients(c.org_id)));

create policy relations_select on core.relations
  for select to authenticated using (
    core.is_org_member(org_id)
    and (source_type <> 'task' or core.can_view_task(source_id))
    and (target_type <> 'task' or core.can_view_task(target_id))
    and (source_type <> 'client' or core.can_view_clients(org_id))
    and (target_type <> 'client' or core.can_view_clients(org_id))
  );

-- Свои записи времени видит сам пользователь; чужие — админы организации.
create policy time_entries_select on core.time_entries
  for select to authenticated using (
    user_id = core.current_user_id()
    or exists (select 1 from core.org_members m
               where m.org_id = org_id and m.user_id = core.current_user_id()
                 and m.role in ('owner','admin'))
  );

create policy recurring_rules_select on core.recurring_rules
  for select to authenticated using (core.is_org_member(org_id));

-- Комментарии к клиентам: ветка 'client' из 0024 наконец получает условие.
drop policy if exists comments_select on core.comments;
create policy comments_select on core.comments
  for select to authenticated using (
    deleted_at is null
    and (
      (entity_type = 'task' and core.can_view_task(entity_id))
      or (entity_type = 'project' and core.can_view_project(entity_id))
      or (entity_type = 'client' and core.can_view_clients(org_id))
    )
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table core.clients, core.time_entries;
  end if;
end;
$$;
