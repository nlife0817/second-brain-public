-- Настройки уведомлений по типам событий.
--
-- Строка на пару (пользователь, тип события). Отсутствие строки = «включено»:
-- так новый тип события начинает работать без бэкфилла, а таблица хранит
-- только осознанные отказы.
--
-- Настройка глобальная, а не по организациям: типы событий одни и те же везде,
-- а «в этой организации не беспокоить, в той беспокоить» — сценарий, которого
-- пока нет. Появится — сюда добавится org_id в первичный ключ.
--
-- inbox = false выключает и запись в инбокс, и push: push раскладывается из
-- core.notifications, второго источника у него нет.

create table if not exists core.notification_prefs (
  user_id uuid not null references core.users(id) on delete cascade,
  kind text not null,
  inbox boolean not null default true,
  push boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

-- Прямого доступа с клиента нет: приложение ходит ролью-владельцем, настройки
-- читаются и пишутся через /api/v2/notifications/prefs (см. правило про RLS
-- в src/lib/core/CLAUDE.md).
alter table core.notification_prefs enable row level security;
