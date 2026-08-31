-- ============================================================================
-- База знаний: документы организации с тем же редактором, что и описание задачи.
--
-- Модель дерева и доступа
-- -----------------------
-- Документ — узел дерева (`parent_id`), отдельной сущности «папка» нет: любой
-- документ может быть и текстом, и разделом. Доступ и привязка к проектам
-- живут ТОЛЬКО у корня ветки (`parent_id IS NULL`), вложенные наследуют их от
-- корня. Иначе ребёнок «выпадал» бы из доступа родителя, и человек, открывший
-- ветку, не понимал бы, куда делась её часть.
--
-- У корня два взаимоисключающих источника доступа:
--   * есть строки в kb_document_projects — доступ берётся из проектов (роль =
--     лучшая из ролей по привязанным проектам). Документ виден в базе знаний
--     каждого из них — это один документ, а не копии;
--   * привязок нет («общий» документ) — доступ по `default_role` организации
--     плюс поимённый список kb_document_members. `default_role IS NULL` —
--     закрытый документ, только по списку (то же правило, что у проектов).
--
-- Позиция в дереве
-- ----------------
-- У вложенного документа и у корневого «общего» позиция одна — `position`.
-- У корневого документа проекта позиция своя В КАЖДОМ проекте, поэтому она
-- лежит в kb_document_projects.position: документ из двух проектов стоит в их
-- деревьях на разных местах, и одной колонкой это не описать.
--
-- Вложения и комментарии
-- ----------------------
-- Отдельных таблиц под них не заводим: у core.attachments и core.doc_comments
-- та же семантика, что в описании задачи, — меняется только владелец. Поэтому
-- `task_id` становится необязательным, рядом появляется `document_id`, и check
-- требует ровно одного из них. Две параллельные пары таблиц означали бы две
-- копии правил отдачи файлов и разбора тредов, которые однажды разойдутся.
--
-- Все таблицы закрыты RLS без политик — как attachments и doc_comments:
-- прямого доступа с клиента к ним нет, приложение ходит ролью-владельцем,
-- а правила живут в policy.ts (см. правило 2 в src/lib/core/CLAUDE.md).
-- ============================================================================

create table core.kb_documents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references core.organizations(id) on delete cascade,
  -- Родитель в дереве. Каскад: удаление узла уносит поддерево целиком, но им
  -- пользуется только окончательная зачистка корзины — обычное удаление мягкое.
  parent_id    uuid references core.kb_documents(id) on delete cascade,
  title        text not null default '',
  -- HTML описания, тот же формат и тот же санитайзер, что у core.tasks.description.
  body         text not null default '',
  position     double precision not null default 0,
  -- Базовая роль организации у корневого документа без проектов. NULL —
  -- закрытый (только по списку). 'admin' недоступен: иначе любой сотрудник
  -- менял бы доступ к документу (то же ограничение, что у projects.default_role).
  default_role core.project_role
    check (default_role is null or default_role in ('viewer','commenter','editor')),
  -- Доступ настраивается на корне ветки: у вложенного документа своей базовой
  -- роли быть не может.
  constraint kb_documents_role_root_ck check (parent_id is null or default_role is null),
  created_by   uuid references core.users(id) on delete set null,
  updated_by   uuid references core.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Корзина. Удаление мягкое и уносит поддерево: у каждого потомка проставляется
  -- своя отметка, чтобы восстановление вернуло ровно то, что унесли.
  deleted_at   timestamptz,
  deleted_by   uuid references core.users(id) on delete set null
);
alter table core.kb_documents enable row level security;
create index idx_core_kb_documents_org on core.kb_documents (org_id, deleted_at, position);
create index idx_core_kb_documents_parent on core.kb_documents (parent_id, position);
create trigger set_updated_at before update on core.kb_documents
  for each row execute function core.set_updated_at();

-- Привязка корневого документа к проектам: доступ и место в дереве проекта.
create table core.kb_document_projects (
  document_id uuid not null references core.kb_documents(id) on delete cascade,
  project_id  uuid not null references core.projects(id) on delete cascade,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  primary key (document_id, project_id)
);
alter table core.kb_document_projects enable row level security;
create index idx_core_kb_doc_projects_project on core.kb_document_projects (project_id, position);

-- Поимённый доступ к общему документу (у документа с проектами не заполняется).
create table core.kb_document_members (
  document_id uuid not null references core.kb_documents(id) on delete cascade,
  user_id     uuid not null references core.users(id) on delete cascade,
  role        core.project_role not null default 'viewer',
  created_at  timestamptz not null default now(),
  primary key (document_id, user_id)
);
alter table core.kb_document_members enable row level security;
create index idx_core_kb_doc_members_user on core.kb_document_members (user_id);

-- История версий. Пишется при сохранении, но правки одного автора подряд
-- склеиваются в одну строку (окно задаётся в kb-model.ts): автосохранение идёт
-- раз в полторы секунды, и без склейки история стала бы нечитаемой.
create table core.kb_document_versions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references core.organizations(id) on delete cascade,
  document_id uuid not null references core.kb_documents(id) on delete cascade,
  title       text not null default '',
  body        text not null default '',
  author_id   uuid references core.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  -- Момент последней правки, вошедшей в эту версию. Отличается от created_at
  -- ровно у склеенных версий.
  updated_at  timestamptz not null default now()
);
alter table core.kb_document_versions enable row level security;
create index idx_core_kb_versions_doc on core.kb_document_versions (document_id, created_at desc);

-- Связь документа с задачами: в документе блок «Задачи», в карточке задачи —
-- блок «Документы». Доступ у сторон свой, поэтому связь ничего не открывает —
-- каждая сторона фильтруется своей видимостью при выдаче.
create table core.kb_document_tasks (
  document_id uuid not null references core.kb_documents(id) on delete cascade,
  task_id     uuid not null references core.tasks(id) on delete cascade,
  created_by  uuid references core.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (document_id, task_id)
);
alter table core.kb_document_tasks enable row level security;
create index idx_core_kb_doc_tasks_task on core.kb_document_tasks (task_id);

-- --- Обобщение вложений и комментариев к тексту -------------------------------
-- Совместимо с работающим кодом: колонка добавляется пустой, NOT NULL снимается,
-- а check выполняется на уже существующих строках (task_id есть, document_id нет).

alter table core.attachments alter column task_id drop not null;
alter table core.attachments
  add column document_id uuid references core.kb_documents(id) on delete cascade;
alter table core.attachments add constraint core_attachments_owner_ck
  check ((task_id is not null) <> (document_id is not null));
create index idx_core_attachments_document on core.attachments (document_id, created_at);

alter table core.doc_comments alter column task_id drop not null;
alter table core.doc_comments
  add column document_id uuid references core.kb_documents(id) on delete cascade;
alter table core.doc_comments add constraint core_doc_comments_owner_ck
  check ((task_id is not null) <> (document_id is not null));
create index idx_core_doc_comments_document on core.doc_comments (document_id, thread_id, created_at);
