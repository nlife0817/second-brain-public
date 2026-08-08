-- ============================================================================
-- Категории статусов и системный статус по умолчанию.
--
-- Было: у статуса только `kind` (open/done/archived), задача могла остаться
-- вообще без статуса (`tasks.status_id` nullable + FK on delete set null), а
-- сервер при создании задачи никакого статуса не подставлял.
--
-- Стало: статусы разложены по четырём категориям — backlog, in_progress, done,
-- archived. Первые три обязаны быть непустыми, archived может пустовать. Ровно
-- один статус организации помечен `is_default` — в него попадает новая задача.
--
-- Почему новая колонка, а не переписанный `kind`.
--   Миграция применяется ДО перезапуска приложения, а уже загруженные вкладки
--   живут часами. Старый код сравнивает `kind === 'open'` и на клиенте
--   (TaskSheet, CreateTaskDialog, ProjectBoard), и на сервере (recurring.ts).
--   Переписав значения на месте, мы бы молча сломали авто-completed_at у всех,
--   кто не перезагрузил страницу. Поэтому `kind` остаётся живым зеркалом под
--   триггером и уходит следующим выкатом. Тот же приём уже применён в
--   0037_core_project_access.sql: default_role как источник истины при живой
--   производной visibility.
--
-- Что НЕ делается здесь и уедет следующей миграцией, когда код перестанет
-- пользоваться старой формой: `tasks.status_id SET NOT NULL`, замена FK на
-- `on delete restrict`, снятие триггера и дроп колонки `kind`.
-- ============================================================================

-- 1. Колонки ------------------------------------------------------------------
-- category заводится nullable и без DEFAULT намеренно: по «пусто» триггер ниже
-- отличает вставку старым кодом (пришёл только kind) от вставки новым.
alter table core.task_statuses
  add column category text check (category in ('backlog', 'in_progress', 'done', 'archived')),
  add column is_default boolean not null default false;

-- 2. Зеркало kind <-> category ------------------------------------------------
-- Generated-колонка тут не подходит: старый INSERT с явным kind упал бы с 428C9.
create or replace function core.task_status_sync_kind()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.category is null then
      new.category := case new.kind
                        when 'done' then 'done'
                        when 'archived' then 'archived'
                        else 'backlog'
                      end;
    else
      new.kind := case new.category
                    when 'done' then 'done'
                    when 'archived' then 'archived'
                    else 'open'
                  end;
    end if;
  else
    if new.category is distinct from old.category then
      new.kind := case new.category
                    when 'done' then 'done'
                    when 'archived' then 'archived'
                    else 'open'
                  end;
    elsif new.kind is distinct from old.kind then
      new.category := case new.kind
                        when 'done' then 'done'
                        when 'archived' then 'archived'
                        else 'backlog'
                      end;
    end if;
  end if;
  return new;
end;
$$;

create trigger task_status_sync_kind
  before insert or update on core.task_statuses
  for each row execute function core.task_status_sync_kind();

-- 3. Раскладка существующих статусов по категориям ----------------------------
update core.task_statuses
set category = case kind
                 when 'done' then 'done'
                 when 'archived' then 'archived'
                 else 'backlog'
               end
where category is null;

-- «В работе» и его синонимы поднимаем из бэклога по имени: сид создаёт ровно
-- такой статус, так что для нетронутых организаций этого шага достаточно.
update core.task_statuses
set category = 'in_progress'
where category = 'backlog'
  and lower(btrim(name)) in (
    'в работе', 'в процессе', 'выполняется', 'делаю',
    'doing', 'in progress', 'in-progress', 'wip'
  );

-- Справочник переименовывали — берём последний рабочий статус по позиции.
-- Только если бэклог при этом не опустеет.
with pick as (
  select distinct on (s.org_id) s.id
  from core.task_statuses s
  where s.category = 'backlog'
    and not exists (
      select 1 from core.task_statuses x
      where x.org_id = s.org_id and x.category = 'in_progress'
    )
    and (
      select count(*) from core.task_statuses y
      where y.org_id = s.org_id and y.category = 'backlog'
    ) > 1
  order by s.org_id, s.position desc, s.created_at desc
)
update core.task_statuses s
set category = 'in_progress'
from pick p
where s.id = p.id;

-- 4. Досоздание системных статусов в пустых категориях ------------------------
-- Порядок блоков важен: позиция каждого считается от уже разложенных соседей.
-- Архив не досоздаём — он единственный, кому разрешено пустовать.
insert into core.task_statuses (org_id, name, color, category, position)
select o.id, 'Бэклог', '#6b7280', 'backlog',
       coalesce((select min(s.position) from core.task_statuses s where s.org_id = o.id), 1) - 1
from core.organizations o
where not exists (
  select 1 from core.task_statuses s where s.org_id = o.id and s.category = 'backlog'
);

insert into core.task_statuses (org_id, name, color, category, position)
select o.id, 'В работе', '#f59e0b', 'in_progress',
       coalesce((select max(s.position) from core.task_statuses s
                 where s.org_id = o.id and s.category = 'backlog'), 0) + 0.5
from core.organizations o
where not exists (
  select 1 from core.task_statuses s where s.org_id = o.id and s.category = 'in_progress'
);

insert into core.task_statuses (org_id, name, color, category, position)
select o.id, 'Готово', '#10b981', 'done',
       coalesce((select max(s.position) from core.task_statuses s
                 where s.org_id = o.id and s.category in ('backlog', 'in_progress')), 0) + 0.5
from core.organizations o
where not exists (
  select 1 from core.task_statuses s where s.org_id = o.id and s.category = 'done'
);

-- 5. Статус по умолчанию ------------------------------------------------------
-- «К выполнению» из сида, иначе первый статус бэклога. Кандидаты ограничены
-- рабочими категориями: новая задача не должна рождаться завершённой.
with pick as (
  select distinct on (org_id) org_id, id
  from core.task_statuses
  where category in ('backlog', 'in_progress')
  order by org_id,
           (lower(btrim(name)) = 'к выполнению') desc,
           (category = 'backlog') desc,
           position,
           created_at
)
update core.task_statuses s
set is_default = true
from pick p
where s.id = p.id;

-- 6. Инварианты ---------------------------------------------------------------
-- Частичный уникальный индекс даёт «не больше одного»; «хотя бы один» держит
-- сервис (orgmeta.ts) плюс защитный ORDER BY в getDefaultStatus.
create unique index idx_core_task_statuses_default
  on core.task_statuses (org_id) where is_default;

alter table core.task_statuses
  add constraint task_statuses_default_is_working
  check (not is_default or category in ('backlog', 'in_progress'));

alter table core.task_statuses alter column category set not null;

-- 7. Задачи без статуса -------------------------------------------------------
update core.tasks t
set status_id = (
  select s.id from core.task_statuses s where s.org_id = t.org_id and s.is_default limit 1
)
where t.status_id is null;
