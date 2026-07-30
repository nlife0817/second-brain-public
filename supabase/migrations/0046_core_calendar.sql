-- ============================================================================
-- Календарь: время начала у задачи и подключённые внешние календари.
--
-- 1. core.tasks.start_time — во сколько задача начинается. До сих пор у начала
--    была только дата (0044), и это было верно для ганта: он считает в днях.
--    Календарь показывает часовую сетку, и без времени начала задача не может
--    быть отрезком внутри дня — её пришлось бы либо рисовать длительностью,
--    которую никто не задавал, либо держать в полосе «весь день» навсегда.
--
--    Пустое время означает «весь день» — ровно как пустой due_time означает
--    срок на день целиком, а не на 00:00. Порядок start_time <= due_time
--    схемой не навязан по той же причине, что и порядок дат в 0044: план, в
--    котором начало позже конца, человек должен увидеть и исправить, а не
--    получить отказ сохранения.
--
-- 2. Внешние календари — три таблицы. Подключение принадлежит пользователю, а
--    не организации, поэтому org_id они не несут: то же решение, что у
--    core.push_subscriptions и core.notification_settings. Личный календарь
--    один и тот же во всех организациях, где человек состоит, и заставлять
--    подключать его заново в каждой — работа на пустом месте. Обратная сторона
--    важнее: привязка к организации означала бы, что события личных встреч
--    живут в тенанте, где их видит его администратор.
--
--    core.calendar_accounts — подключение (аккаунт Google или ICS-ссылка).
--    core.calendars        — календари внутри подключения, каждый со своей
--                            галкой видимости и точкой синхронизации.
--    core.calendar_events  — сами события. Это КЭШ внешнего источника, а не
--                            наши данные: пишет его только синхронизация, а
--                            приложение читает. Задачами они не становятся
--                            никогда — отсюда отсутствие любых ссылок на
--                            core.tasks.
--
-- Совместимость с работающим кодом: файл только добавляет. Колонка приходит
-- nullable и без бэкфилла, таблицы — новые, поэтому те минуты, пока приложение
-- ещё не перезапущено, старый код работает как прежде (он перечисляет колонки
-- задачи явно — TASK_LIST_COLUMNS в lib/core/tasks.ts).
--
-- Таблицы закрыты RLS без политик: прямого доступа с клиента к ним нет,
-- приложение ходит ролью-владельцем (см. правило про RLS в
-- src/lib/core/CLAUDE.md).
-- ============================================================================

alter table core.tasks add column if not exists start_time time;

-- ---------------------------------------------------------------------------
-- Подключения
-- ---------------------------------------------------------------------------

create table core.calendar_accounts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references core.users(id) on delete cascade,
  provider     text not null check (provider in ('google', 'ics')),
  -- Что показать в списке подключений: адрес аккаунта Google или хост
  -- ICS-ссылки. Секретом не является и уходит в API — в отличие от secret.
  label        text not null default '',
  -- Чем подключение опознаётся у провайдера: sub аккаунта Google, а у ICS —
  -- отпечаток ссылки. Нужен, чтобы повторное подключение того же источника
  -- обновляло существующую строку, а не заводило дубль в списке.
  external_id  text not null,
  -- Refresh-токен Google или сама ICS-ссылка, зашифрованные AES-GCM ключом из
  -- CALENDAR_TOKEN_KEY (lib/core/secret-box.ts). Байты этой таблицы попадают в
  -- каждый ночной дамп, а refresh-токен даёт доступ к чужому календарю на
  -- неограниченный срок — в отличие от сессии, которую можно просто
  -- переподписать. Наружу колонка не отдаётся ни одним роутом.
  secret       text not null,
  -- Текст последней неудачи синхронизации. Отзыв доступа в аккаунте Google
  -- нельзя заметить иначе: подключение просто перестаёт обновляться, и человек
  -- смотрит на календарь недельной давности, считая его сегодняшним.
  sync_error   text,
  last_sync_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, provider, external_id)
);
alter table core.calendar_accounts enable row level security;

-- ---------------------------------------------------------------------------
-- Календари внутри подключения
-- ---------------------------------------------------------------------------

create table core.calendars (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references core.calendar_accounts(id) on delete cascade,
  -- calendarId у Google; у ICS-подписки календарь один, и внешнего id у неё
  -- нет — там пустая строка.
  external_id  text not null default '',
  name         text not null default '',
  -- Цвет из внешнего календаря; пользователь может задать свой (color_override),
  -- потому что палитра Google с нашей темой не согласована.
  color        text,
  color_override text,
  timezone     text,
  -- Показывать ли этот календарь на полотне. Подключают аккаунт целиком, а
  -- смотреть хотят не на всё: «Праздники России» и чужой рабочий календарь
  -- приезжают вместе с рабочим, но нужны не всегда.
  visible      boolean not null default true,
  -- Точка инкрементальной синхронизации Google: следующий запрос отдаёт только
  -- изменения. Сбрасывается в null, когда Google отвечает 410 (токен устарел) —
  -- тогда календарь перечитывается целиком.
  sync_token   text,
  -- ETag ICS-ссылки: сервер отдаёт 304, и разбирать килобайты текста заново не
  -- приходится.
  http_etag    text,
  last_sync_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (account_id, external_id)
);
alter table core.calendars enable row level security;

-- ---------------------------------------------------------------------------
-- События
-- ---------------------------------------------------------------------------

create table core.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references core.calendars(id) on delete cascade,
  -- id события у Google; у ICS — UID плюс начало экземпляра, потому что повтор
  -- разворачивается в отдельные строки.
  external_id text not null,
  title       text not null default '',
  description text,
  location    text,
  all_day     boolean not null,
  -- Событие «на весь день» — это дни, а не моменты: «29–31 июля» остаётся тем
  -- же событием в любой зоне, из которой на него смотрят. Конец включительный
  -- (Google отдаёт его исключительно — приводим на входе), как end у полосы
  -- ганта: событие «по 31-е» занимает весь 31-й день.
  start_date  date,
  end_date    date,
  -- Событие со временем — момент, а не «дата + время». Зона у него своя
  -- (организатора), смотрят на него в своей, и единственное, что можно
  -- сравнивать, — моменты. Этим оно и отличается от срока задачи, который у нас
  -- намеренно «плавающий» (date + time без зоны, см. 0024).
  starts_at   timestamptz,
  ends_at     timestamptz,
  -- confirmed | tentative | cancelled. Отменённое приезжает инкрементальной
  -- синхронизацией как признак удаления, но у ICS отменённое встречается и в
  -- обычной выдаче.
  status      text,
  organizer   text,
  -- Ссылка на событие во внешнем календаре: править его можно только там.
  html_link   text,
  -- Отметка изменения на стороне источника — не наша updated_at.
  external_updated_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Ровно одно из двух представлений заполнено. Без этого «событие на весь
  -- день» с проставленным starts_at разошлось бы с самим собой: выборка окна
  -- ищет его по датам, а раскладка на полотне — по моменту.
  constraint calendar_events_span check (
    (all_day and start_date is not null and end_date is not null
      and starts_at is null and ends_at is null)
    or
    (not all_day and starts_at is not null and ends_at is not null
      and start_date is null and end_date is null)
  ),
  unique (calendar_id, external_id)
);
alter table core.calendar_events enable row level security;

-- Выборка идёт окном по календарю, и у двух представлений ключи разные:
-- «весь день» ищется по датам, событие со временем — по моменту.
create index idx_core_calendar_events_days on core.calendar_events (calendar_id, end_date, start_date)
  where all_day;
create index idx_core_calendar_events_span on core.calendar_events (calendar_id, ends_at, starts_at)
  where not all_day;
