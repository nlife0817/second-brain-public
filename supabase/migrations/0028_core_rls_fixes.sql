-- ============================================================================
-- Исправления RLS по итогам ревью фазы 2.
--
-- 1. time_entries_select: внутри подзапроса неквалифицированный org_id
--    разрешался в core.org_members.org_id — сравнение колонки с самой собой,
--    условие всегда истинно. Любой owner/admin любой организации читал чужие
--    записи времени через Realtime. Квалифицируем внешнюю колонку.
-- 2. relations_select: не было ветки для 'project' — связи с приватными
--    проектами видел любой член организации, включая гостя.
-- 3. recurring_rules_select: шаблон правила (проект, исполнители, описание)
--    был виден всем членам организации.
-- ============================================================================

drop policy if exists time_entries_select on core.time_entries;
create policy time_entries_select on core.time_entries
  for select to authenticated using (
    user_id = core.current_user_id()
    or exists (select 1 from core.org_members m
               where m.org_id = time_entries.org_id
                 and m.user_id = core.current_user_id()
                 and m.role in ('owner','admin'))
  );

drop policy if exists relations_select on core.relations;
create policy relations_select on core.relations
  for select to authenticated using (
    core.is_org_member(org_id)
    and (source_type <> 'task' or core.can_view_task(source_id))
    and (target_type <> 'task' or core.can_view_task(target_id))
    and (source_type <> 'project' or core.can_view_project(source_id))
    and (target_type <> 'project' or core.can_view_project(target_id))
    and (source_type <> 'client' or core.can_view_clients(org_id))
    and (target_type <> 'client' or core.can_view_clients(org_id))
  );

drop policy if exists recurring_rules_select on core.recurring_rules;
create policy recurring_rules_select on core.recurring_rules
  for select to authenticated using (
    created_by = core.current_user_id()
    or (
      (template->>'project_id') is not null
      and core.can_view_project((template->>'project_id')::uuid)
    )
  );
