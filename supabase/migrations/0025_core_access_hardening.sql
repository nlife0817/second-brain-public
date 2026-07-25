-- ============================================================================
-- Ужесточение доступа по итогам ревью фазы 1.
--
-- 1. can_view_task: подписка (follower) даёт видимость только для задач без
--    размещений во всей цепочке (личный инбокс). Иначе исключённый из проекта
--    участник сохранял бы доступ навсегда, самоподписавшись на задачи.
--    Зеркало логики loadTaskAccess() в src/lib/core/tasks.ts.
-- 2. comments_select: не отдавать мягко удалённые комментарии (в т.ч. в Realtime).
-- ============================================================================

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
  ),
  placed as (
    select exists (
      select 1 from core.task_projects tp join chain c on c.id = tp.task_id
    ) as has_placement
  )
  select exists (
    select 1 from chain t, placed p
    where t.created_by = core.current_user_id()
      or exists (select 1 from core.task_assignees a
                 where a.task_id = t.id and a.user_id = core.current_user_id())
      or (not p.has_placement and exists (
            select 1 from core.task_followers f
            where f.task_id = t.id and f.user_id = core.current_user_id()))
      or exists (select 1 from core.task_projects tp
                 where tp.task_id = t.id and core.can_view_project(tp.project_id))
  );
$$;

drop policy if exists comments_select on core.comments;
create policy comments_select on core.comments
  for select to authenticated using (
    deleted_at is null
    and (
      (entity_type = 'task' and core.can_view_task(entity_id))
      or (entity_type = 'project' and core.can_view_project(entity_id))
    )
  );
