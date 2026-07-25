-- Push-подписки пользователей v2.
--
-- В public.push_subscriptions user_email жёстко ссылается на whitelist v1
-- (public.users), поэтому участник организации v2, которого нет в whitelist,
-- подписаться там не может. Своя таблица привязана к core.users; старые
-- v1-подписки продолжают работать — диспетчер шлёт в объединение обеих таблиц.

create table if not exists core.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_core_push_subscriptions_user
  on core.push_subscriptions (user_id);

-- Прямого доступа с клиента к endpoint'ам нет и не должно быть:
-- RLS без политик закрывает таблицу для anon/authenticated, приложение
-- ходит ролью-владельцем (см. правило про RLS в src/lib/core/CLAUDE.md).
alter table core.push_subscriptions enable row level security;
