-- Напоминания о сроках, тихие часы и отключение уведомлений по проекту.

-- 1. Личные настройки доставки (одна строка на пользователя).
--
-- Часовой пояс нужен и напоминаниям, и тихим часам: сроки задач хранятся как
-- date + time без зоны, «сегодня» и «22:00» существуют только в локальном
-- времени человека. Значение присылает браузер (Intl), поэтому обновляется само
-- при первом же визите; до этого действует прежний умолчательный пояс
-- приложения — он лучше UTC, при котором утренняя сводка приходила бы днём.
create table if not exists core.notification_settings (
  user_id           uuid primary key references core.users(id) on delete cascade,
  timezone          text not null default 'Asia/Novosibirsk',
  quiet_enabled     boolean not null default false,
  quiet_start       time not null default '22:00',
  quiet_end         time not null default '08:00',
  -- Час утренней сводки в локальном времени.
  digest_hour       smallint not null default 9 check (digest_hour between 0 and 23),
  reminders_enabled boolean not null default true,
  updated_at        timestamptz not null default now()
);
alter table core.notification_settings enable row level security;

-- 2. Отключение уведомлений по проекту (личное, не влияет на других).
create table if not exists core.project_mutes (
  user_id    uuid not null references core.users(id) on delete cascade,
  project_id uuid not null references core.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);
alter table core.project_mutes enable row level security;

-- 3. Отметки отправленных напоминаний.
--
-- Напоминание привязано к поводу, а не к моменту запуска: slot — это ключ
-- повода («задача X со сроком на 2026-07-30 18:00», «сводка за 2026-07-30»).
-- Уникальность по (пользователь, тип, повод) означает, что пропущенный тик
-- ничего не теряет — следующий живой тик отработает тот же повод ровно один
-- раз, сколько бы раз он ни запускался.
create table if not exists core.reminder_sent (
  user_id    uuid not null references core.users(id) on delete cascade,
  kind       text not null,
  slot       text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, slot)
);
alter table core.reminder_sent enable row level security;
-- Чистка старых отметок в cron идёт по времени.
create index if not exists idx_core_reminder_sent_created
  on core.reminder_sent (created_at);

-- 4. Уведомления без события.
--
-- До сих пор уведомление всегда рождалось из мутации и брало сущность из
-- core.events. У напоминания автора нет: событие пришлось бы придумывать, и
-- оно засоряло бы ленту задачи и уходило в вебхуки как чужое действие.
-- Поэтому уведомление умеет нести ссылку само; для событийных уведомлений
-- колонки остаются пустыми, а чтение берёт первое непустое.
alter table core.notifications
  add column if not exists entity_type text,
  add column if not exists entity_id   uuid,
  add column if not exists payload     jsonb not null default '{}';
