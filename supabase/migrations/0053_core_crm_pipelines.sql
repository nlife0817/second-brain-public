-- ============================================================================
-- CRM: воронки продаж и сделки.
--
-- Раздел «Клиенты» (0026) был плоским справочником: у клиента статус, бюджет и
-- пара текстовых полей. Продажи так не ведутся — у них процесс, а процесс живёт
-- не на клиенте, а на СДЕЛКЕ: один и тот же клиент возвращается за вторым
-- заказом, и «статус клиента» отвечал бы сразу на два вопроса и ни на один
-- честно. Отсюда модель amoCRM: сделка едет по этапам воронки, клиент остаётся
-- аккаунтом с историей сделок.
--
--   core.pipelines           — воронка организации (их может быть несколько);
--   core.pipeline_stages     — этапы воронки: вид open/won/lost + вероятность;
--   core.deals               — сделка: сумма, клиент, ответственный, атрибуция;
--   core.deal_stage_history  — строка на каждый ВХОД в этап;
--   core.lead_sources        — откуда пришёл лид;
--   core.lost_reasons        — почему отказались.
--
-- Три решения, которые стоит понимать, читая эту схему:
--
-- 1. Статус сделки НЕ хранится: он выводится из kind её этапа. Две колонки на
--    одно и то же разъехались бы на первой же правке справочника.
-- 2. deal_stage_history — фундамент всей аналитики. Конверсия считается по
--    тому, сколько сделок ВХОДИЛО в этап за период, а не по снимку доски: снимок
--    отвечает «где они сейчас», а воронка — «сколько дошло». Поэтому строка
--    пишется на каждый вход, в той же транзакции, что и перенос.
-- 3. Атрибуция разложена по колонкам, а не в jsonb: по utm_source и
--    utm_campaign группируют отчёты, а группировка по ключу jsonb — это
--    последовательное сканирование там, где нужен индекс.
--
-- Этапы удаляются мягко (archived_at): история ссылается на stage_id, и жёсткое
-- удаление выбило бы строку из отчёта за прошлый период — воронка за июль
-- перестала бы сходиться задним числом.
--
-- Совместимость: миграция только добавляет объекты. Легаси-колонки клиента
-- (budget, operators_*, calls_per_month) и client_statuses живы — код перестаёт
-- их показывать этим выкатом, а снос отдельной миграцией, когда выкат уляжется.
-- ============================================================================

-- --- Воронки -----------------------------------------------------------------

create table core.pipelines (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references core.organizations(id) on delete cascade,
  name       text not null,
  -- Воронка по умолчанию ровно одна: в неё попадают сделки, у которых воронку
  -- не указали, и она открывается на доске первой.
  is_default boolean not null default false,
  -- Не всякая воронка про деньги: у холодной рассылки «выиграно» — это
  -- активация, а не оплата, и колонка сумм показывала бы прочерки.
  track_amounts boolean not null default true,
  position   double precision not null default 1,
  created_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table core.pipelines enable row level security;
create trigger set_updated_at before update on core.pipelines
  for each row execute function core.set_updated_at();

create index idx_core_pipelines_org on core.pipelines (org_id, position);
create unique index idx_core_pipelines_default on core.pipelines (org_id) where is_default;

-- --- Этапы --------------------------------------------------------------------

create table core.pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references core.organizations(id) on delete cascade,
  pipeline_id uuid not null references core.pipelines(id) on delete cascade,
  name        text not null,
  color       text not null default '#6b7280',
  -- open — рабочий этап, won/lost — итог. Из вида выводится и статус сделки, и
  -- то, что этап нельзя удалить: итог есть в каждой воронке.
  kind        text not null default 'open' check (kind in ('open', 'won', 'lost')),
  -- Вероятность закрытия, % — задел под взвешенный прогноз выручки.
  probability int not null default 0 check (probability between 0 and 100),
  position    double precision not null default 1,
  -- Мягкое удаление: этап уходит с доски, но остаётся в отчётах за периоды,
  -- когда сделки через него проходили.
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table core.pipeline_stages enable row level security;
create trigger set_updated_at before update on core.pipeline_stages
  for each row execute function core.set_updated_at();

create index idx_core_pipeline_stages_pipeline on core.pipeline_stages (pipeline_id, position);
create index idx_core_pipeline_stages_org on core.pipeline_stages (org_id);

-- --- Справочники --------------------------------------------------------------

create table core.lead_sources (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references core.organizations(id) on delete cascade,
  name     text not null,
  color    text not null default '#6b7280',
  position double precision not null default 1,
  created_at timestamptz not null default now()
);
alter table core.lead_sources enable row level security;
create index idx_core_lead_sources_org on core.lead_sources (org_id, position);
create unique index idx_core_lead_sources_name on core.lead_sources (org_id, name);

create table core.lost_reasons (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references core.organizations(id) on delete cascade,
  name     text not null,
  position double precision not null default 1,
  created_at timestamptz not null default now()
);
alter table core.lost_reasons enable row level security;
create index idx_core_lost_reasons_org on core.lost_reasons (org_id, position);
create unique index idx_core_lost_reasons_name on core.lost_reasons (org_id, name);

-- --- Сделки -------------------------------------------------------------------

create table core.deals (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references core.organizations(id) on delete cascade,
  pipeline_id uuid not null references core.pipelines(id) on delete cascade,
  stage_id    uuid not null references core.pipeline_stages(id),
  title       text not null default '',
  amount      numeric,
  -- Клиента может не быть: сырая заявка приходит с одним телефоном, а аккаунт
  -- появляется при квалификации. Удаление клиента сделку не уносит — она уже
  -- часть истории продаж.
  client_id   uuid references core.clients(id) on delete set null,
  assignee_id uuid references core.users(id) on delete set null,
  -- Контакт лида до привязки к клиенту.
  contact_name     text not null default '',
  contact_phone    text not null default '',
  contact_email    text not null default '',
  contact_telegram text not null default '',
  -- Атрибуция: откуда пришёл и по какой рекламе.
  source_id     uuid references core.lead_sources(id) on delete set null,
  utm_source    text not null default '',
  utm_medium    text not null default '',
  utm_campaign  text not null default '',
  utm_term      text not null default '',
  utm_content   text not null default '',
  referrer      text not null default '',
  landing_page  text not null default '',
  lost_reason_id uuid references core.lost_reasons(id) on delete set null,
  -- Проставляется входом в этап вида won/lost и снимается возвратом в работу.
  closed_at   timestamptz,
  position    double precision not null default 1,
  created_by  uuid references core.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table core.deals enable row level security;
create trigger set_updated_at before update on core.deals
  for each row execute function core.set_updated_at();

-- Доска читает сделки одного этапа по порядку — этим индексом.
create index idx_core_deals_board on core.deals (org_id, pipeline_id, stage_id, position);
create index idx_core_deals_client on core.deals (client_id);
create index idx_core_deals_assignee on core.deals (org_id, assignee_id);
create index idx_core_deals_created on core.deals (org_id, created_at desc);
-- Поиск по названию сделки — как у клиентов (0026).
create index idx_core_deals_title_trgm on core.deals using gin (title gin_trgm_ops);

-- --- История этапов -----------------------------------------------------------

create table core.deal_stage_history (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references core.organizations(id) on delete cascade,
  deal_id    uuid not null references core.deals(id) on delete cascade,
  stage_id   uuid not null references core.pipeline_stages(id),
  actor_id   uuid references core.users(id) on delete set null,
  entered_at timestamptz not null default now()
);
alter table core.deal_stage_history enable row level security;

create index idx_core_deal_stage_history_deal on core.deal_stage_history (deal_id, entered_at);
-- Отчёты идут по периоду и этапу: «сколько сделок входило в этап за июль».
create index idx_core_deal_stage_history_report on core.deal_stage_history (org_id, entered_at, stage_id);

-- --- RLS ----------------------------------------------------------------------
-- Страховка на случай прямого доступа к базе: приложение ходит ролью-владельцем
-- и политики обходит, реальные проверки — в policy.ts. Право то же, что у
-- клиентов (0026): сотрудник и выше, гость отрезан.

create policy pipelines_select on core.pipelines for select
  using (core.can_view_clients(org_id));
create policy pipeline_stages_select on core.pipeline_stages for select
  using (core.can_view_clients(org_id));
create policy lead_sources_select on core.lead_sources for select
  using (core.can_view_clients(org_id));
create policy lost_reasons_select on core.lost_reasons for select
  using (core.can_view_clients(org_id));
create policy deals_select on core.deals for select
  using (core.can_view_clients(org_id));
create policy deal_stage_history_select on core.deal_stage_history for select
  using (core.can_view_clients(org_id));

-- --- Сид: воронка «Продажи» каждой организации ---------------------------------
-- Воронка рождается непустой: пустая не приняла бы ни одной сделки, а без
-- итоговых этапов не считается ни одна конверсия. Ровно то же правило, что у
-- набора статусов (0052).

insert into core.pipelines (org_id, name, is_default, position)
  select id, 'Продажи', true, 1 from core.organizations;

insert into core.pipeline_stages (org_id, pipeline_id, name, color, kind, probability, position)
  select p.org_id, p.id, s.name, s.color, s.kind, s.probability, s.position
    from core.pipelines p
    cross join (values
      ('Неразобранное', '#94a3b8', 'open',  0,   1::double precision),
      ('Квалификация',  '#3b82f6', 'open',  20,  2),
      ('Переговоры',    '#8b5cf6', 'open',  50,  3),
      ('Оплата',        '#f59e0b', 'open',  80,  4),
      ('Выиграно',      '#10b981', 'won',   100, 5),
      ('Проиграно',     '#dc2626', 'lost',  0,   6)
    ) as s(name, color, kind, probability, position)
   where p.is_default;

-- Причины отказа: без справочника аналитика проигрышей слепая.
insert into core.lost_reasons (org_id, name, position)
  select o.id, r.name, r.position from core.organizations o
    cross join (values
      ('Дорого', 1::double precision),
      ('Выбрали конкурента', 2),
      ('Не отвечает', 3),
      ('Не вовремя', 4),
      ('Не наш профиль', 5)
    ) as r(name, position);
