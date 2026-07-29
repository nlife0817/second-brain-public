-- ============================================================================
-- Описание задачи как документ: вложения и комментарии к тексту.
--
-- 1. core.attachments — файлы, вставленные в описание. Байты лежат прямо в БД
--    (bytea): своего объектного хранилища у нас нет, а том Docker не попадает
--    в pg_dump, которым снимается ежедневный бэкап. Плата — размер дампа, из-за
--    неё файл ограничен 10 МБ (ATTACHMENT_MAX_BYTES в lib/core/attachments.ts),
--    а картинки ужимаются в браузере до вставки.
--
-- 2. core.doc_comments — комментарии к фрагменту описания (как в Google Docs):
--    тред с ответами, правкой и закрытием. Отдельная таблица, а не core.comments:
--    у обсуждения задачи нет ни привязки к тексту, ни тредов, ни резолва, и
--    смешивать две ленты в одной вкладке нельзя.
--
--    Привязка к тексту — mark <span data-comment="<thread_id>"> в HTML описания.
--    Фрагмент дублируется в колонке quote: текст правят, и якорь может исчезнуть —
--    тогда тред показывается «открепившимся», но не теряется.
--
-- Обе таблицы закрыты RLS без политик: прямого доступа с клиента к ним нет,
-- приложение ходит ролью-владельцем (см. правило про RLS в src/lib/core/CLAUDE.md).
-- ============================================================================

create table core.attachments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references core.organizations(id) on delete cascade,
  -- Права наследуются от задачи целиком: отдельного ACL у файла нет.
  task_id     uuid not null references core.tasks(id) on delete cascade,
  uploaded_by uuid references core.users(id) on delete set null,
  filename    text not null,
  mime_type   text not null,
  byte_size   integer not null check (byte_size > 0),
  -- Размеры картинки считает браузер при вставке: нужны, чтобы зарезервировать
  -- место под изображение до его загрузки. Для не-картинок null.
  width       integer,
  height      integer,
  data        bytea not null,
  created_at  timestamptz not null default now()
);
alter table core.attachments enable row level security;
create index idx_core_attachments_task on core.attachments (task_id, created_at);
create index idx_core_attachments_org on core.attachments (org_id, created_at desc);

create table core.doc_comments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references core.organizations(id) on delete cascade,
  task_id     uuid not null references core.tasks(id) on delete cascade,
  -- Корень треда: у первого комментария thread_id = id (проставляет приложение).
  thread_id   uuid not null,
  parent_id   uuid references core.doc_comments(id) on delete cascade,
  author_id   uuid references core.users(id) on delete set null,
  body        text not null default '',
  -- Текст, выделенный в момент создания треда. Только у корня.
  quote       text not null default '',
  -- Закрытие относится к треду целиком, поэтому заполняется только у корня.
  resolved_at timestamptz,
  resolved_by uuid references core.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  deleted_at  timestamptz
);
alter table core.doc_comments enable row level security;
create index idx_core_doc_comments_task on core.doc_comments (task_id, thread_id, created_at);
create index idx_core_doc_comments_thread on core.doc_comments (thread_id, created_at);
