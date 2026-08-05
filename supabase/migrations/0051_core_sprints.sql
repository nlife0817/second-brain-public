-- ============================================================================
-- Режим проекта «Разработка»: спринты и бэклог.
--
-- 1. core.projects.mode — 'standard' (как было) или 'dev'. Режим включает
--    дополнительные виды экрана проекта; на обычные проекты не влияет ничем.
--
-- 2. core.sprints — итерация внутри проекта. Принадлежит ОДНОМУ проекту, а не
--    организации: спринт это план конкретной команды на конкретной работе.
--    Ёмкость хранится в минутах — той же единицей, что tasks.estimated_minutes,
--    иначе «набрано 28 из 40 ч» пришлось бы считать в двух системах измерения.
--    Активный спринт в проекте ровно один — держит частичный уникальный индекс
--    (тем же приёмом, что is_default у статуса, см. 0041).
--
-- 3. core.tasks.sprint_id — задача входит не более чем в один спринт. Задача
--    при этом может лежать в нескольких проектах (multi-homing), поэтому
--    принадлежность спринту проверяет сервис: проект спринта обязан быть в
--    цепочке размещений задачи.
--
--    on delete set null: удаление спринта не имеет права уносить задачи — тот
--    же принцип, по которому deleteProject не трогает задачи.
--
-- 4. core.tasks.sprint_carry_count — сколько раз задача НЕ поместилась в
--    завершаемый спринт и уехала в следующий. Растёт только в completeSprint:
--    перепланирование до старта переездом не считается. Из этого счётчика
--    интерфейс рисует метку «3-й спринт» — сигнал разбить задачу или отказаться
--    от неё.
--
-- Ранга бэклога здесь нет намеренно: порядок задачи внутри проекта уже есть —
-- core.task_projects.position, по нему сортирует listProjectTasks и его правит
-- moveTaskInProject. Это же снимает вопрос multi-homing: у задачи в двух
-- проектах два независимых ранга.
--
-- Совместимость с работающим кодом: файл только добавляет. Колонки приходят с
-- умолчаниями, таблица новая — минуту-другую до перезапуска приложения старый
-- код работает как прежде (он перечисляет колонки явно).
--
-- Таблица закрыта RLS без политик: приложение ходит ролью-владельцем, прямого
-- доступа с клиента нет (см. правило про RLS в src/lib/core/CLAUDE.md).
-- ============================================================================

alter table core.projects
  add column if not exists mode text not null default 'standard';

alter table core.projects
  drop constraint if exists projects_mode_check;
alter table core.projects
  add constraint projects_mode_check check (mode in ('standard', 'dev'));

create table core.sprints (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references core.organizations(id) on delete cascade,
  project_id       uuid not null references core.projects(id) on delete cascade,
  name             text not null,
  goal             text not null default '',
  starts_on        date,
  ends_on          date,
  state            text not null default 'planned' check (state in ('planned', 'active', 'completed')),
  -- Ёмкость в минутах; null — ёмкость не задана, интерфейс покажет только сумму.
  capacity_minutes integer check (capacity_minutes is null or capacity_minutes > 0),
  position         double precision not null default 1,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_by       uuid references core.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table core.sprints enable row level security;
create trigger set_updated_at before update on core.sprints
  for each row execute function core.set_updated_at();

create index idx_core_sprints_project on core.sprints (org_id, project_id, position);
-- «Не больше одного активного» — индекс; «активный вообще есть» инвариантом не
-- является: проект без активного спринта это нормальное состояние между итерациями.
create unique index idx_core_sprints_one_active on core.sprints (project_id) where state = 'active';

alter table core.tasks
  add column if not exists sprint_id uuid references core.sprints(id) on delete set null;
alter table core.tasks
  add column if not exists sprint_carry_count integer not null default 0;

create index idx_core_tasks_sprint on core.tasks (org_id, sprint_id) where sprint_id is not null;
