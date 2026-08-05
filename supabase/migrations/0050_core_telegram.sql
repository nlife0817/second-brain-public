-- Telegram как второй канал доставки тех же уведомлений, что уходят в push.
--
-- Привязка принадлежит пользователю, а не организации (как core.push_subscriptions):
-- телеграм у человека один на все организации, а привязка к тенанту означала бы,
-- что личный чат виден чужому администратору.
--
-- Ограничения намеренно жёсткие с обеих сторон:
--   * primary key (user_id) — один чат на человека. Второй телеграм-аккаунт
--     тому же пользователю не нужен, а «привязок сколько угодно» превращает
--     отписку в перебор.
--   * unique (chat_id) — один чат не обслуживает двух пользователей. Иначе
--     привязка чужого чата становится способом читать чужие уведомления;
--     перепривязка (delete по chat_id перед insert) остаётся возможной, потому
--     что одноразовый код подтверждает и того, кто привязывает, и сам чат.

create table if not exists core.telegram_chats (
  user_id uuid primary key references core.users(id) on delete cascade,
  chat_id bigint not null unique,
  username text,
  first_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Одноразовые коды привязки: их значение уезжает в ссылку t.me/<bot>?start=<code>,
-- то есть в буфер обмена и историю переходов. Отсюда короткий срок жизни,
-- отметка использования и правило «новая ссылка гасит прежнюю» — ровно как у
-- ссылок установки пароля (core.password_tokens).
create table if not exists core.telegram_link_codes (
  code text primary key,
  user_id uuid not null references core.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists telegram_link_codes_user_idx
    on core.telegram_link_codes (user_id);

-- Прямого доступа с клиента нет: приложение ходит ролью-владельцем, привязка
-- живёт через /api/v2/telegram/* (см. правило про RLS в src/lib/core/CLAUDE.md).
alter table core.telegram_chats enable row level security;
alter table core.telegram_link_codes enable row level security;

-- Третий канал доставки рядом с inbox и push. Значение по умолчанию — true,
-- как у push: отсутствие строки в notification_prefs означает «включено», и
-- бэкфилл существующих строк обязан совпадать с этим умолчанием, иначе у тех,
-- кто когда-то трогал настройки, телеграм молча не работал бы.
alter table core.notification_prefs add column if not exists telegram boolean not null default true;

-- Кроме одного случая: у выключенного инбокса не бывает включённой доставки —
-- рассылка собирается из core.notifications, а её при inbox = false нет.
-- setNotificationPref держит этот инвариант на записи; здесь выравниваем то,
-- что уже лежит в таблице.
update core.notification_prefs set telegram = false where inbox = false;
