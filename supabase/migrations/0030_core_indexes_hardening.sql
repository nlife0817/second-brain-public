-- ============================================================================
-- Индексы под внешние ключи ядра и фиксация search_path у функций core
-- (Supabase advisors: 0001_unindexed_foreign_keys, 0011_function_search_path).
--
-- Без индекса на FK каждый DELETE родителя вызывает seq scan дочерней таблицы —
-- на удалении организации/проекта это заметно уже на тысячах задач.
-- ============================================================================

create index if not exists idx_core_comments_org on core.comments (org_id);
create index if not exists idx_core_comments_author on core.comments (author_id);
create index if not exists idx_core_notifications_org on core.notifications (org_id);
create index if not exists idx_core_notifications_event on core.notifications (event_id);
create index if not exists idx_core_events_actor on core.events (actor_id);
create index if not exists idx_core_tasks_status on core.tasks (status_id);
create index if not exists idx_core_task_projects_section on core.task_projects (section_id);
create index if not exists idx_core_projects_team on core.projects (team_id);
create index if not exists idx_core_projects_created_by on core.projects (created_by);
create index if not exists idx_core_organizations_created_by on core.organizations (created_by);
create index if not exists idx_core_relations_org on core.relations (org_id);
create index if not exists idx_core_relations_type on core.relations (relation_type_id);
create index if not exists idx_core_relations_created_by on core.relations (created_by);
create index if not exists idx_core_clients_created_by on core.clients (created_by);
create index if not exists idx_core_client_notes_author on core.client_notes (author_id);
create index if not exists idx_core_invitations_invited_by on core.invitations (invited_by);
create index if not exists idx_core_invitations_accepted_by on core.invitations (accepted_by);
create index if not exists idx_core_recurring_created_by on core.recurring_rules (created_by);
create index if not exists idx_core_recurring_last_task on core.recurring_rules (last_task_id);
create index if not exists idx_core_webhooks_created_by on core.webhooks (created_by);
create index if not exists idx_core_webhook_deliveries_event on core.webhook_deliveries (event_id);

alter function core.set_updated_at() set search_path = core, public;
alter function core._mig_ts(text) set search_path = core, public;
alter function core._mig_date(text) set search_path = core, public;
alter function core._mig_time(text) set search_path = core, public;
