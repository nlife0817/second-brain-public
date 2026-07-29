-- ============================================================================
-- Гант: дата начала задачи и зависимости между задачами.
--
-- 1. core.tasks.start_date — левая граница полосы. До сих пор у задачи был
--    только срок (due_date), и «когда начинаем» приходилось держать в голове.
--    Выводить начало из оценки нельзя: задача, которая стартует через две
--    недели, ничем не отличалась бы от начатой сегодня.
--
--    Время у начала намеренно не хранится: гант считает в днях, а точное
--    «во сколько» имеет смысл только у срока (due_time — напоминания).
--    Порядок start_date <= due_date схемой не навязан: план, у которого
--    начало позже срока, — это состояние, которое пользователь видит и
--    исправляет, а не ошибка записи, из-за которой отваливается сохранение.
--
-- 2. core.relation_types.kind — какой смысл у типа связи. Связи (миграция 0026)
--    были произвольными именованными ярлыками: по строке «Блокирует» отличить
--    зависимость от заметки «см. также» невозможно, а гант рисует стрелки
--    только по настоящим зависимостям. 'generic' — прежнее поведение,
--    'blocks' — источник блокирует цель (стрелка от конца источника к началу
--    цели).
--
--    Каждой организации заводится тип «Блокирует»: без него стрелки негде
--    было бы взять, а заставлять каждого владельца создавать тип руками ради
--    того, чтобы вид вообще заработал, — плохой первый опыт. Организации, у
--    которой такой тип уже есть, он просто помечается как зависимость.
-- ============================================================================

alter table core.tasks add column if not exists start_date date;

alter table core.relation_types
  add column if not exists kind text not null default 'generic';

-- Ограничение отдельным шагом: в отличие от add column ... if not exists у
-- add constraint такой формы нет, а повторный прогон файла возможен.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'relation_types_kind_check'
  ) then
    alter table core.relation_types
      add constraint relation_types_kind_check check (kind in ('generic', 'blocks'));
  end if;
end $$;

insert into core.relation_types (org_id, name, color, icon, position, kind)
select
  o.id,
  'Блокирует',
  '#ef4444',
  'Ban',
  coalesce((select max(rt.position) + 1 from core.relation_types rt where rt.org_id = o.id), 1),
  'blocks'
from core.organizations o
on conflict (org_id, name) do update set kind = 'blocks';
