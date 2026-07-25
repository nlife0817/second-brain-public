-- ============================================================================
-- Доступ сотрудников к проекту задаётся настройками самого проекта.
--
-- Было: бинарная visibility ('org' | 'private'), а роль сотрудника в org-проекте
-- зашита в коде (member → editor). Стало: core.projects.default_role — базовая
-- роль, которую получает любой сотрудник организации (owner/admin/member),
-- не имеющий явной записи в project_members:
--
--   NULL        — закрытый проект: только явные участники (в т.ч. для owner/admin);
--   'viewer'    — все сотрудники видят, правят только участники;
--   'commenter' — все видят и комментируют;
--   'editor'    — прежнее поведение org-проекта.
--
-- 'admin' в default_role не допускается: иначе любой сотрудник смог бы менять
-- настройки проекта и удалить его.
--
-- visibility остаётся производной колонкой (generated): её читают UI-бейдж,
-- экспорт организации и внешние потребители Realtime. Единственный источник
-- истины — default_role; зеркало правил в TypeScript — effectiveProjectRole()
-- в src/lib/core/policy.ts.
-- ============================================================================

alter table core.projects
  add column default_role core.project_role
  check (default_role is null or default_role <> 'admin');

-- Перенос текущего поведения: org → editor, private → закрытый (NULL).
update core.projects set default_role = 'editor' where visibility = 'org';

alter table core.projects drop column visibility;
alter table core.projects
  add column visibility text
  generated always as (case when default_role is null then 'private' else 'org' end) stored;
alter table core.projects alter column visibility set not null;

-- ----------------------------------------------------------------------------
-- RLS-зеркало (страховка и Realtime): те же правила, что в policy.ts
-- ----------------------------------------------------------------------------
create or replace function core.can_view_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
    from core.projects p
    join core.org_members m
      on m.org_id = p.org_id and m.user_id = core.current_user_id()
    where p.id = p_project
      and (
        exists (
          select 1 from core.project_members pm
          where pm.project_id = p.id and pm.user_id = m.user_id
        )
        -- закрытый проект (default_role is null) — только по явному членству,
        -- даже для owner/admin; гость — всегда только по явному членству
        or (p.default_role is not null and m.role in ('owner','admin','member'))
      )
  );
$$;

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
        or (p.default_role is not null and m.role in ('owner','admin','member'))
      )
  );
$$;
