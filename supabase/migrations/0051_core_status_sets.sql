-- ============================================================================
-- Наборы статусов: у проекта может быть свой рабочий процесс.
--
-- До сих пор справочник статусов был один на организацию (0041, 0045). Режиму
-- «Разработка» нужен свой ряд — «К работе → В работе → Code review → QA →
-- Готово», — но навязывать его отделу продаж нельзя. Отсюда набор:
--
--   core.status_sets      — именованный набор статусов организации;
--   task_statuses.set_id  — к какому набору относится статус;
--   projects.status_set_id— какой набор показывает проект (null = основной).
--
-- Категории (`backlog / in_progress / done / archived`) остаются семантикой
-- ядра: «Code review» — это `in_progress`, и вся логика completed_at, скрытия
-- архива и группировок продолжает работать без правок. Набор задаёт СОСТАВ, а
-- не поведение.
--
-- Инварианты справочника переезжают с организации на набор: ровно один
-- `is_default` (частичный уникальный индекс ниже), обязательные категории не
-- пустеют и позиции 1..N — это уже сервис (orgmeta.ts).
--
-- Задача при этом остаётся одна на все свои проекты (multi-homing), а статус у
-- неё один. Поэтому набор — то, что ПОКАЗЫВАЕМ в проекте, а не то, что
-- запрещаем: доска рисует колонки набора плюс фактически встречающиеся чужие
-- статусы, иначе задача из двух проектов исчезла бы из одного из них.
--
-- Совместимость с работающим кодом. Минуту-другую до перезапуска приложения
-- старый код вставляет статусы без `set_id` — их не увидел бы ни один экран.
-- Поэтому на время перехода стоит триггер, проставляющий набор по умолчанию.
-- Следующим выкатом, когда весь код научится набору: `set_id set not null` и
-- `drop trigger core_task_statuses_set_id_default`.
-- ============================================================================

create table core.status_sets (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references core.organizations(id) on delete cascade,
  name       text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table core.status_sets enable row level security;
create trigger set_updated_at before update on core.status_sets
  for each row execute function core.set_updated_at();

create index idx_core_status_sets_org on core.status_sets (org_id, created_at);
-- Набор по умолчанию в организации ровно один: в него встают проекты, которые
-- своего набора не выбирали, и он же принимает статусы от старого кода.
create unique index idx_core_status_sets_default on core.status_sets (org_id) where is_default;

alter table core.task_statuses add column if not exists set_id uuid references core.status_sets(id) on delete cascade;
alter table core.projects add column if not exists status_set_id uuid references core.status_sets(id) on delete set null;

-- Бэкфилл: каждой организации набор «Основной» со всеми её статусами.
insert into core.status_sets (org_id, name, is_default)
  select id, 'Основной', true from core.organizations;

update core.task_statuses s
   set set_id = ss.id
  from core.status_sets ss
 where ss.org_id = s.org_id and ss.is_default and s.set_id is null;

create index idx_core_task_statuses_set on core.task_statuses (set_id, position);

-- Дефолтный статус уникален внутри набора, а не организации: у каждого набора
-- свой статус новой задачи. Индекс по организации (0041) снимаем — с двумя
-- наборами он запретил бы второму иметь дефолт вовсе.
drop index if exists core.idx_core_task_statuses_default;
create unique index idx_core_task_statuses_default on core.task_statuses (set_id) where is_default;

-- Мост на время выката: старый код вставляет статус без набора.
create or replace function core.task_status_default_set() returns trigger
language plpgsql as $$
begin
  if new.set_id is null then
    select id into new.set_id from core.status_sets
     where org_id = new.org_id and is_default limit 1;
  end if;
  return new;
end;
$$;

create trigger core_task_statuses_set_id_default
  before insert on core.task_statuses
  for each row execute function core.task_status_default_set();
