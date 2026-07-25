-- ============================================================================
-- Перенос данных v1 (public) → v2 (core). Идемпотентно: соответствия старых и
-- новых id хранятся в core.migration_map, повторный прогон ничего не дублирует.
--
-- Переносится: item_statuses, categories (+ спец-проект «Прочее»), приватные
-- проекты по типам (Заметки/Идеи/Встречи/Планы), items → tasks (+ подзадачи,
-- размещения), tags/item_tags, comments (entity_type='item').
-- НЕ переносится: weekly plans и planning-система (фича убрана), Kaiten,
-- development stages/participants, time_entries и relations (фаза 2).
--
-- Запуск: Supabase SQL Editor или MCP execute_sql. Старые таблицы не меняются.
-- ============================================================================

create table if not exists core.migration_map (
  old_table text not null,
  old_id    text not null,
  new_id    uuid not null,
  primary key (old_table, old_id)
);

-- Парсеры легаси-форматов (sqlite-текстовые даты v1).
create or replace function core._mig_ts(t text) returns timestamptz
language sql immutable as $$
  select case
    when t is null then now()
    when t ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}' then (left(replace(t, 'T', ' '), 19))::timestamp at time zone 'UTC'
    when t ~ '^\d{4}-\d{2}-\d{2}$' then t::timestamp at time zone 'UTC'
    else now()
  end
$$;

create or replace function core._mig_date(t text) returns date
language sql immutable as $$
  select case when t ~ '^\d{4}-\d{2}-\d{2}' then left(t, 10)::date else null end
$$;

create or replace function core._mig_time(t text) returns time
language sql immutable as $$
  select case when t ~ '^\d{2}:\d{2}' then left(t, 5)::time else null end
$$;

do $$
declare
  v_org uuid;
  v_owner uuid;
  v_owner2 uuid;
  r record;
  v_new uuid;
  v_proj uuid;
  v_status uuid;
  v_task uuid;
begin
  select id, created_by into v_org, v_owner from core.organizations order by created_at limit 1;
  if v_org is null then
    raise exception 'core.organizations пуста — сначала миграция 0023';
  end if;
  if v_owner is null then
    select user_id into v_owner from core.org_members
    where org_id = v_org and role = 'owner' order by created_at limit 1;
  end if;
  select user_id into v_owner2 from core.org_members
  where org_id = v_org and role = 'owner' and user_id <> v_owner
  order by created_at limit 1;

  ---------------------------------------------------------------------------
  -- 1. Статусы задач
  ---------------------------------------------------------------------------
  for r in select * from public.item_statuses order by position loop
    if exists (select 1 from core.migration_map where old_table = 'item_statuses' and old_id = r.id) then
      continue;
    end if;
    insert into core.task_statuses (org_id, name, color, kind, position)
    values (v_org, r.name, r.color, r.kind, r.position)
    returning id into v_new;
    insert into core.migration_map values ('item_statuses', r.id, v_new);
  end loop;

  ---------------------------------------------------------------------------
  -- 2. Категории → org-видимые проекты (+ «Прочее» для category='other')
  ---------------------------------------------------------------------------
  for r in select * from public.categories order by position loop
    if exists (select 1 from core.migration_map where old_table = 'categories' and old_id = r.id) then
      continue;
    end if;
    insert into core.projects (org_id, name, color, icon, visibility, position, created_by)
    values (v_org, r.name, r.color, r.icon, 'org', r.position, v_owner)
    returning id into v_new;
    insert into core.project_members (project_id, user_id, role)
    values (v_new, v_owner, 'admin') on conflict do nothing;
    insert into core.migration_map values ('categories', r.id, v_new);
  end loop;

  if not exists (select 1 from core.migration_map where old_table = 'categories' and old_id = 'other') then
    insert into core.projects (org_id, name, color, icon, visibility, position, created_by)
    values (v_org, 'Прочее', '#6b7280', 'Folder', 'org', 900, v_owner)
    returning id into v_new;
    insert into core.project_members (project_id, user_id, role)
    values (v_new, v_owner, 'admin') on conflict do nothing;
    insert into core.migration_map values ('categories', 'other', v_new);
  end if;

  ---------------------------------------------------------------------------
  -- 3. Приватные проекты личного контура (заметки/идеи/встречи/планы)
  ---------------------------------------------------------------------------
  for r in
    select * from (values
      ('type:note',    'Заметки', 'StickyNote', '#8b5cf6', 1001.0),
      ('type:idea',    'Идеи',    'Lightbulb',  '#f59e0b', 1002.0),
      ('type:meeting', 'Встречи', 'Calendar',   '#3b82f6', 1003.0),
      ('type:plan',    'Планы',   'Map',        '#10b981', 1004.0)
    ) as t(key, name, icon, color, pos)
  loop
    if exists (select 1 from core.migration_map where old_table = 'type_projects' and old_id = r.key) then
      continue;
    end if;
    insert into core.projects (org_id, name, color, icon, visibility, position, created_by)
    values (v_org, r.name, r.color, r.icon, 'private', r.pos, v_owner)
    returning id into v_new;
    insert into core.project_members (project_id, user_id, role)
    values (v_new, v_owner, 'admin') on conflict do nothing;
    if v_owner2 is not null then
      insert into core.project_members (project_id, user_id, role)
      values (v_new, v_owner2, 'admin') on conflict do nothing;
    end if;
    insert into core.migration_map values ('type_projects', r.key, v_new);
  end loop;

  ---------------------------------------------------------------------------
  -- 4. Теги (совпадающие по имени — переиспользуются)
  ---------------------------------------------------------------------------
  for r in select * from public.tags order by position loop
    if exists (select 1 from core.migration_map where old_table = 'tags' and old_id = r.id) then
      continue;
    end if;
    v_new := null;
    select id into v_new from core.tags where org_id = v_org and name = r.name;
    if v_new is null then
      insert into core.tags (org_id, name, color, position)
      values (v_org, r.name, r.color, r.position)
      returning id into v_new;
    end if;
    insert into core.migration_map values ('tags', r.id, v_new);
  end loop;

  ---------------------------------------------------------------------------
  -- 5. items → tasks (все типы; created_by — владелец личного контура)
  ---------------------------------------------------------------------------
  for r in select * from public.items order by created_at, id loop
    if exists (select 1 from core.migration_map where old_table = 'items' and old_id = r.id) then
      continue;
    end if;
    v_status := null;
    select new_id into v_status from core.migration_map
    where old_table = 'item_statuses' and old_id = r.status;

    insert into core.tasks
      (org_id, title, description, status_id, priority, due_date, due_time,
       estimated_minutes, source, created_by, completed_at, created_at, updated_at)
    values
      (v_org, r.title, r.description, v_status,
       case when r.priority in ('urgent','high','medium','low','none') then r.priority else 'none' end,
       core._mig_date(r.due_date), core._mig_time(r.due_time), r.estimated_minutes,
       case when coalesce(r.source, '') = '' then 'import' else r.source end,
       v_owner,
       case when exists (select 1 from core.task_statuses s
                         where s.id = v_status and s.kind in ('done','archived'))
            then core._mig_ts(r.updated_at) end,
       core._mig_ts(r.created_at), core._mig_ts(r.updated_at))
    returning id into v_task;
    insert into core.migration_map values ('items', r.id, v_task);
  end loop;

  ---------------------------------------------------------------------------
  -- 6. Иерархия подзадач
  ---------------------------------------------------------------------------
  update core.tasks t
  set parent_task_id = pm.new_id
  from public.items i
  join core.migration_map m  on m.old_table = 'items' and m.old_id = i.id
  join core.migration_map pm on pm.old_table = 'items' and pm.old_id = i.parent_id
  where t.id = m.new_id and i.parent_id is not null and t.parent_task_id is null;

  ---------------------------------------------------------------------------
  -- 7. Размещения корневых задач по проектам (подзадачи живут под родителем)
  ---------------------------------------------------------------------------
  for r in select * from public.items where parent_id is null order by position, created_at loop
    v_task := null; v_proj := null;
    select new_id into v_task from core.migration_map where old_table = 'items' and old_id = r.id;
    if v_task is null then continue; end if;
    if exists (select 1 from core.task_projects where task_id = v_task) then continue; end if;
    if r.type = 'task' then
      select new_id into v_proj from core.migration_map
      where old_table = 'categories' and old_id = coalesce(r.category, 'other');
      if v_proj is null then
        select new_id into v_proj from core.migration_map
        where old_table = 'categories' and old_id = 'other';
      end if;
    else
      select new_id into v_proj from core.migration_map
      where old_table = 'type_projects' and old_id = 'type:' || r.type;
    end if;
    if v_proj is not null then
      insert into core.task_projects (task_id, project_id, section_id, position)
      values (v_task, v_proj, null, coalesce(r.position, 0))
      on conflict do nothing;
    end if;
  end loop;

  ---------------------------------------------------------------------------
  -- 8. Теги задач
  ---------------------------------------------------------------------------
  insert into core.task_tags (task_id, tag_id)
  select tm.new_id, gm.new_id
  from public.item_tags it
  join core.migration_map tm on tm.old_table = 'items' and tm.old_id = it.item_id
  join core.migration_map gm on gm.old_table = 'tags' and gm.old_id = it.tag_id
  on conflict do nothing;

  ---------------------------------------------------------------------------
  -- 9. Комментарии к задачам
  ---------------------------------------------------------------------------
  for r in select * from public.comments where entity_type = 'item' order by created_at loop
    if exists (select 1 from core.migration_map where old_table = 'comments' and old_id = r.id) then
      continue;
    end if;
    v_task := null;
    select new_id into v_task from core.migration_map where old_table = 'items' and old_id = r.entity_id;
    if v_task is null then continue; end if;
    insert into core.comments (org_id, entity_type, entity_id, author_id, author_label, body, created_at)
    values (v_org, 'task', v_task,
            (select id from core.users where email = lower(r.author_email)),
            coalesce(r.author_email, ''), r.text, core._mig_ts(r.created_at))
    returning id into v_new;
    insert into core.migration_map values ('comments', r.id, v_new);
  end loop;
end;
$$;

-- Контрольные суммы переноса
select
  (select count(*) from public.items)                             as v1_items,
  (select count(*) from core.tasks)                               as v2_tasks,
  (select count(*) from public.categories) + 5                    as v1_projects_expected, -- +«Прочее» +4 типовых
  (select count(*) from core.projects)                            as v2_projects,
  (select count(*) from public.item_tags)                         as v1_item_tags,
  (select count(*) from core.task_tags)                           as v2_task_tags,
  (select count(*) from public.comments where entity_type='item') as v1_comments,
  (select count(*) from core.comments)                            as v2_comments,
  (select count(*) from core.task_projects)                       as v2_placements;
