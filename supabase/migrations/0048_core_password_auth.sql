-- Вход по email и паролю вместо Google OAuth.
--
-- Совместимость с работающим кодом: миграция только добавляет колонку и
-- таблицу. Пароль у существующих пользователей остаётся NULL — их сессии
-- (подписанная cookie, 30 дней) продолжают работать, а пароль они заведут
-- сами в настройках или по одноразовой ссылке от владельца.

-- Хеш пароля в формате scrypt$N$r$p$<salt-b64url>$<hash-b64url> (lib/auth/password.ts).
-- NULL — учётка без пароля: войти по нему нельзя, нужна ссылка установки.
alter table core.users add column if not exists password_hash text;

comment on column core.users.password_hash is
  'scrypt-хеш пароля; NULL — пароль ещё не задан, вход возможен только по ссылке установки';

-- Одноразовые ссылки «задать пароль»: почты в системе нет, поэтому ссылку
-- владелец организации копирует в настройках и передаёт человеку лично —
-- ровно так же, как уже работают приглашения.
create table if not exists core.password_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references core.users(id) on delete cascade,
  token_hash  text not null unique,        -- sha256(token) hex; сырой токен виден один раз
  created_by  uuid references core.users(id) on delete set null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
alter table core.password_tokens enable row level security;
create index if not exists idx_core_password_tokens_user
  on core.password_tokens (user_id, created_at desc);

comment on table core.password_tokens is
  'Одноразовые ссылки установки пароля. Ссылка — bearer-секрет: почты нет, владение адресом ей не подтверждается, поэтому передаётся лично и живёт недолго.';
