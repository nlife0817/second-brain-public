-- ============================================================================
-- Совместимость со своим Postgres (переезд с Supabase Cloud на VPS).
--
-- ПРИМЕНЯТЬ ДО pg_restore — дамп схем public и core не восстановится без
-- объектов, на которые он ссылается:
--
--   * роли anon / authenticated / service_role — в дампе есть CREATE POLICY … TO
--     <роль>; несуществующая роль роняет каждую такую команду (их около сорока);
--   * функции auth.uid() / auth.jwt() — на них опираются политики RLS
--     (0002_rls.sql, 0023_core_foundation.sql, 0032_core_webhook_scope.sql);
--   * расширение pg_trgm — поиск v2 (0026_core_clients_time_search.sql).
--
-- Политики оставляем как есть: приложение подключается ролью-владельцем и
-- обходит RLS (см. src/lib/core/CLAUDE.md), но сохранённые политики — задел
-- на отдельную роль коннекта с FORCE ROW LEVEL SECURITY.
-- ============================================================================

create extension if not exists pg_trgm;

-- ---- Роли Supabase как заглушки --------------------------------------------
-- NOLOGIN: подключиться ими нельзя, они нужны только чтобы политики ссылались
-- на существующие имена. Прав не выдаём — RLS у нас не первый рубеж.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- ---- Схема auth: заглушки вместо GoTrue ------------------------------------
-- Без Supabase Auth текущего пользователя в сессии Postgres нет, поэтому
-- функции возвращают null. Для политик это deny-by-default: core.current_user_id()
-- не найдёт пользователя, и ни одна policy не пропустит строку. Именно то
-- поведение, которое нужно при прямом подключении к базе мимо приложения.
create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$ select null::uuid $$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$ select null::jsonb $$;

create or replace function auth.role()
returns text
language sql
stable
as $$ select null::text $$;

comment on schema auth is
  'Заглушка вместо Supabase GoTrue: функции возвращают null, политики RLS работают в режиме deny-by-default. Идентичность живёт в core.users, проверки прав — в src/lib/core/policy.ts.';
