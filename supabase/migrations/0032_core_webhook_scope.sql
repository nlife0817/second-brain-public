-- ============================================================================
-- Вебхуки не должны выносить наружу содержимое приватных проектов, к которым
-- создатель вебхука не имеет доступа: payload событий содержит заголовки задач,
-- имена проектов и клиентов, а адрес доставки задаёт админ организации.
--
-- Событие ставится в очередь, только если создатель вебхука видит его сущность.
-- Проверка выполняется от имени создателя (без auth.uid()), поэтому нужны
-- собственные функции видимости с явным user_id.
-- ============================================================================

create or replace function core.user_can_view_project(p_user uuid, p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
    from core.projects p
    join core.org_members m on m.org_id = p.org_id and m.user_id = p_user
    where p.id = p_project
      and (
        exists (select 1 from core.project_members pm
                where pm.project_id = p.id and pm.user_id = p_user)
        or (p.visibility = 'org' and m.role in ('owner','admin','member'))
      )
  );
$$;

create or replace function core.user_can_view_task(p_user uuid, p_task uuid)
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
    from core.tasks t join chain c on t.id = c.parent_task_id
    where c.depth < 8
  ),
  placed as (
    select exists (
      select 1 from core.task_projects tp join chain c on c.id = tp.task_id
    ) as has_placement
  )
  select exists (
    select 1 from chain t, placed p
    where t.created_by = p_user
      or exists (select 1 from core.task_assignees a
                 where a.task_id = t.id and a.user_id = p_user)
      or (not p.has_placement and exists (
            select 1 from core.task_followers f
            where f.task_id = t.id and f.user_id = p_user))
      or exists (select 1 from core.task_projects tp
                 where tp.task_id = t.id and core.user_can_view_project(p_user, tp.project_id))
  );
$$;

revoke execute on function core.user_can_view_project(uuid, uuid) from public, anon, authenticated;
revoke execute on function core.user_can_view_task(uuid, uuid) from public, anon, authenticated;
grant execute on function core.user_can_view_project(uuid, uuid) to service_role;
grant execute on function core.user_can_view_task(uuid, uuid) to service_role;

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
    and (
      w.created_by is null
      or new.entity_type not in ('task','project')
      or (new.entity_type = 'task' and core.user_can_view_task(w.created_by, new.entity_id))
      or (new.entity_type = 'project' and core.user_can_view_project(w.created_by, new.entity_id))
    )
  on conflict do nothing;
  return new;
end;
$$;
