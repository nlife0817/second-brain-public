-- ============================================================================
-- v2 core tasks: проекты, секции, задачи (multi-homing), исполнители,
-- подписчики, теги, кастомные поля, комментарии, события, уведомления.
--
-- Решения:
--   * due_date date + due_time time (без таймзонных сюрпризов, как в Asana) —
--     вместо due_at timestamptz из первоначального эскиза; конверсия в момент
--     нотификаций делается в таймзоне организации (org.settings.timezone).
--   * priority — те же текстовые значения, что в v1 (urgent…none): UI-конфиги
--     переиспользуются без словаря соответствий.
--   * Приватный проект видят ТОЛЬКО явные участники — org owner/admin не имеют
--     имплицитного доступа (защита личного контура). В org-видимых проектах
--     owner/admin/member имеют имплицитный доступ.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Статусы задач (настраиваемые, org-уровень; порт item_statuses)
-- ----------------------------------------------------------------------------
create table core.task_statuses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references core.organizations(id) on delete cascade,
  name        text not null,
  color       text not null default '#6b7280',
  kind        text not null default 'open' check (kind in ('open','done','archived')),
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table core.task_statuses enable row level security;
create index idx_core_task_statuses_org on core.task_statuses (org_id, position);
create trigger set_updated_at before update on core.task_statuses
  for each row execute function core.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Проекты, участники, секции
-- ----------------------------------------------------------------------------
create table core.projects (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references core.organizations(id) on delete cascade,
  team_id     uuid references core.teams(id) on delete set null,
  name        text not null,
  description text not null default '',
  color       text not null default '#6b7280',
  icon        text not null default 'Folder',
  visibility  text not null default 'org' check (visibility in ('org','private')),
  position    double precision not null default 0,
  archived_at timestamptz,
  created_by  uuid references core.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table core.projects enable row level security;
create index idx_core_projects_org on core.projects (org_id, archived_at, position);
create trigger set_updated_at before update on core.projects
  for each row execute function core.set_updated_at();

create table core.project_members (
  project_id  uuid not null references core.projects(id) on delete cascade,
  user_id     uuid not null references core.users(id) on delete cascade,
  role        core.project_role not null default 'editor',
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
alter table core.project_members enable row level security;
create index idx_core_project_members_user on core.project_members (user_id);

create table core.sections (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references core.projects(id) on delete cascade,
  name        text not null,
  position    double precision not null default 0,
  created_at  timestamptz not null default now()
);
alter table core.sections enable row level security;
create index idx_core_sections_project on core.sections (project_id, position);

-- ----------------------------------------------------------------------------
-- 3. Задачи + multi-homing
-- ----------------------------------------------------------------------------
create table core.tasks (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references core.organizations(id) on delete cascade,
  title             text not null default '',
  description       text not null default '',       -- Tiptap HTML (sanitize на записи)
  status_id         uuid references core.task_statuses(id) on delete set null,
  priority          text not null default 'none' check (priority in ('urgent','high','medium','low','none')),
  due_date          date,
  due_time          time,
  estimated_minutes integer,
  completed_at      timestamptz,
  parent_task_id    uuid references core.tasks(id) on delete cascade,
  source            text not null default 'app',
  created_by        uuid references core.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table core.tasks enable row level security;
create index idx_core_tasks_org_status on core.tasks (org_id, status_id);
create index idx_core_tasks_org_due on core.tasks (org_id, due_date) where completed_at is null;
create index idx_core_tasks_parent on core.tasks (parent_task_id);
create index idx_core_tasks_org_updated on core.tasks (org_id, updated_at desc);
create index idx_core_tasks_created_by on core.tasks (created_by);
create trigger set_updated_at before update on core.tasks
  for each row execute function core.set_updated_at();

create table core.task_projects (
  task_id     uuid not null references core.tasks(id) on delete cascade,
  project_id  uuid not null references core.projects(id) on delete cascade,
  section_id  uuid references core.sections(id) on delete set null,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  primary key (task_id, project_id)
);
alter table core.task_projects enable row level security;
create index idx_core_task_projects_project on core.task_projects (project_id, section_id, position);

create table core.task_assignees (
  task_id     uuid not null references core.tasks(id) on delete cascade,
  user_id     uuid not null references core.users(id) on delete cascade,
  is_primary  boolean not null default false,   -- первый назначенный = ответственный
  created_at  timestamptz not null default now(),
  primary key (task_id, user_id)
);
alter table core.task_assignees enable row level security;
create index idx_core_task_assignees_user on core.task_assignees (user_id);

create table core.task_followers (
  task_id     uuid not null references core.tasks(id) on delete cascade,
  user_id     uuid not null references core.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (task_id, user_id)
);
alter table core.task_followers enable row level security;
create index idx_core_task_followers_user on core.task_followers (user_id);

-- ----------------------------------------------------------------------------
-- 4. Теги
-- ----------------------------------------------------------------------------
create table core.tags (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references core.organizations(id) on delete cascade,
  name        text not null,
  color       text not null default '#6b7280',
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  unique (org_id, name)
);
alter table core.tags enable row level security;

create table core.task_tags (
  task_id  uuid not null references core.tasks(id) on delete cascade,
  tag_id   uuid not null references core.tags(id) on delete cascade,
  primary key (task_id, tag_id)
);
alter table core.task_tags enable row level security;
create index idx_core_task_tags_tag on core.task_tags (tag_id);

-- ----------------------------------------------------------------------------
-- 5. Кастомные поля
-- ----------------------------------------------------------------------------
create type core.field_type as enum
  ('text','number','select','multi_select','date','user','checkbox','url');

create table core.custom_fields (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references core.organizations(id) on delete cascade,
  project_id  uuid references core.projects(id) on delete cascade,  -- null = поле всей org
  name        text not null,
  type        core.field_type not null,
  options     jsonb not null default '[]',   -- select/multi_select: [{id,label,color}]
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table core.custom_fields enable row level security;
create index idx_core_custom_fields_org on core.custom_fields (org_id, position);
create index idx_core_custom_fields_project on core.custom_fields (project_id);
create trigger set_updated_at before update on core.custom_fields
  for each row execute function core.set_updated_at();

create table core.task_field_values (
  task_id     uuid not null references core.tasks(id) on delete cascade,
  field_id    uuid not null references core.custom_fields(id) on delete cascade,
  value       jsonb,
  updated_at  timestamptz not null default now(),
  primary key (task_id, field_id)
);
alter table core.task_field_values enable row level security;
create index idx_core_task_field_values_field on core.task_field_values (field_id);

-- ----------------------------------------------------------------------------
-- 6. Комментарии (полиморфные), события, уведомления
-- ----------------------------------------------------------------------------
create table core.comments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references core.organizations(id) on delete cascade,
  entity_type  text not null check (entity_type in ('task','project','client')),
  entity_id    uuid not null,
  author_id    uuid references core.users(id) on delete set null,
  author_label text not null default '',    -- fallback для мигрированных author_email
  body         text not null default '',
  created_at   timestamptz not null default now(),
  edited_at    timestamptz,
  deleted_at   timestamptz
);
alter table core.comments enable row level security;
create index idx_core_comments_entity on core.comments (entity_type, entity_id, created_at);

create table core.events (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references core.organizations(id) on delete cascade,
  actor_id     uuid references core.users(id) on delete set null,
  entity_type  text not null,               -- task / project / client / org
  entity_id    uuid not null,
  verb         text not null,               -- task.created, task.assigned, comment.added…
  payload      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
alter table core.events enable row level security;
create index idx_core_events_entity on core.events (entity_type, entity_id, id desc);
create index idx_core_events_org on core.events (org_id, id desc);

create table core.notifications (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references core.organizations(id) on delete cascade,
  user_id       uuid not null references core.users(id) on delete cascade,
  event_id      bigint references core.events(id) on delete cascade,
  kind          text not null,              -- assigned / comment / status_changed / due_soon…
  read_at       timestamptz,
  dispatched_at timestamptz,                -- отметка push-отправки (диспетчер, фаза 2)
  created_at    timestamptz not null default now()
);
alter table core.notifications enable row level security;
create index idx_core_notifications_inbox on core.notifications (user_id, read_at, created_at desc);
create index idx_core_notifications_undispatched on core.notifications (created_at) where dispatched_at is null;

-- ----------------------------------------------------------------------------
-- 7. RLS-хелперы видимости
-- ----------------------------------------------------------------------------
create or replace function core.can_view_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
    from core.projects p
    join core.org_members m
      on m.org_id = p.org_id and m.user_id = core.current_user_id()
    where p.id = p_project
      and (
        exists (
          select 1 from core.project_members pm
          where pm.project_id = p.id and pm.user_id = m.user_id
        )
        -- приватные проекты — только по явному членству, даже для owner/admin
        or (p.visibility = 'org' and m.role in ('owner','admin','member'))
      )
  );
$$;

-- Доступ к задаче: свои роли на самой задаче или на любом её предке
-- (подзадачи наследуют видимость родителя; лимит глубины 8).
create or replace function core.can_view_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  with recursive chain as (
    select id, created_by, parent_task_id, 0 as depth
    from core.tasks where id = p_task
    union all
    select t.id, t.created_by, t.parent_task_id, c.depth + 1
    from core.tasks t
    join chain c on t.id = c.parent_task_id
    where c.depth < 8
  )
  select exists (
    select 1 from chain t
    where t.created_by = core.current_user_id()
      or exists (select 1 from core.task_assignees a
                 where a.task_id = t.id and a.user_id = core.current_user_id())
      or exists (select 1 from core.task_followers f
                 where f.task_id = t.id and f.user_id = core.current_user_id())
      or exists (select 1 from core.task_projects tp
                 where tp.task_id = t.id and core.can_view_project(tp.project_id))
  );
$$;

revoke execute on function core.can_view_project(uuid) from public, anon;
revoke execute on function core.can_view_task(uuid) from public, anon;
grant execute on function core.can_view_project(uuid) to authenticated, service_role;
grant execute on function core.can_view_task(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. Политики SELECT (Realtime + страховка; записи только через API)
-- ----------------------------------------------------------------------------
create policy task_statuses_select on core.task_statuses
  for select to authenticated using (core.is_org_member(org_id));

create policy projects_select on core.projects
  for select to authenticated using (core.can_view_project(id));

create policy project_members_select on core.project_members
  for select to authenticated using (core.can_view_project(project_id));

create policy sections_select on core.sections
  for select to authenticated using (core.can_view_project(project_id));

create policy tasks_select on core.tasks
  for select to authenticated using (core.can_view_task(id));

create policy task_projects_select on core.task_projects
  for select to authenticated using (core.can_view_project(project_id));

create policy task_assignees_select on core.task_assignees
  for select to authenticated using (core.can_view_task(task_id));

create policy task_followers_select on core.task_followers
  for select to authenticated using (core.can_view_task(task_id));

create policy tags_select on core.tags
  for select to authenticated using (core.is_org_member(org_id));

create policy task_tags_select on core.task_tags
  for select to authenticated using (core.can_view_task(task_id));

create policy custom_fields_select on core.custom_fields
  for select to authenticated using (core.is_org_member(org_id));

create policy task_field_values_select on core.task_field_values
  for select to authenticated using (core.can_view_task(task_id));

create policy comments_select on core.comments
  for select to authenticated using (
    (entity_type = 'task' and core.can_view_task(entity_id))
    or (entity_type = 'project' and core.can_view_project(entity_id))
    -- client-ветка добавится в 0025 вместе с CRM v2
  );

create policy events_select on core.events
  for select to authenticated using (
    (entity_type = 'task' and core.can_view_task(entity_id))
    or (entity_type = 'project' and core.can_view_project(entity_id))
  );

create policy notifications_select on core.notifications
  for select to authenticated using (user_id = core.current_user_id());

-- ----------------------------------------------------------------------------
-- 9. Realtime: публикуем изменения ключевых таблиц (браузер слушает через RLS)
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      core.tasks, core.task_projects, core.sections, core.comments, core.notifications;
  end if;
end;
$$;
