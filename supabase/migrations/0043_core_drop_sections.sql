-- Секции проекта удалены из приложения: справочник заводился в настройках,
-- но ни доска, ни списки, ни карточка задачи его не использовали.
--
-- Применять ТОЛЬКО после выката кода, который перестал читать core.sections и
-- task_projects.section_id (коммит «feat(projects): удалить секции проекта»).

-- Композитный индекс включает section_id и уйдёт вместе с колонкой — заранее
-- заводим замену: по (project_id, position) идут списки и порядок на доске.
create index if not exists idx_core_task_projects_project_position
  on core.task_projects (project_id, position);

-- Публикация Realtime осталась от Supabase; на своём Postgres её может не быть.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'core' and tablename = 'sections'
  ) then
    alter publication supabase_realtime drop table core.sections;
  end if;
end;
$$;

-- Колонка уносит с собой внешний ключ и оба индекса по section_id.
alter table core.task_projects drop column if exists section_id;

drop table if exists core.sections;
