-- ============================================================================
-- Папки в базе знаний.
--
-- До этой миграции роль раздела играл сам документ: вложенность задавалась
-- `parent_id`, и детей мог иметь любой документ. Двух способов вложить одно в
-- другое быть не должно — человеку неочевидно, чем «документ внутри документа»
-- отличается от «документа в папке». Поэтому:
--
--   * `kind` = 'document' | 'folder' — папка это тот же узел дерева, но без
--     текста, версий, вложений и обсуждений. Отдельной таблицы нет намеренно:
--     иначе дерево, перенос, корзина и правила доступа существовали бы в двух
--     копиях и разошлись бы на первой правке;
--   * детей может иметь ТОЛЬКО папка. Проверить это check-констрейнтом нельзя
--     (нужна соседняя строка), поэтому правило держит сервис — `kb.ts`;
--   * доступ и привязка к проектам по-прежнему живут у корня ветки, и корнем
--     теперь чаще будет папка.
--
-- Бэкфилл переносит уже сложившиеся ветки: на каждый документ с детьми
-- заводится папка с его же названием, встаёт на его место (включая привязки к
-- проектам и список доступа), а сам документ и его дети уезжают внутрь. Текст
-- при этом не теряется — документ остаётся документом, просто становится
-- листом.
-- ============================================================================

alter table core.kb_documents
  add column kind text not null default 'document'
  check (kind in ('document', 'folder'));

-- Дерево читается по (родитель, вид, позиция): папки идут перед документами.
create index idx_core_kb_documents_kind on core.kb_documents (parent_id, kind, position);

-- --- Бэкфилл: документ с детьми → папка с тем же названием ------------------

create temporary table kb_folder_map on commit drop as
select p.id as doc_id, gen_random_uuid() as folder_id
from core.kb_documents p
where exists (select 1 from core.kb_documents c where c.parent_id = p.id);

-- Папка встаёт ровно туда, где стоял документ: тот же родитель, та же позиция,
-- та же базовая роль (её документ мог нести, только будучи корнем).
insert into core.kb_documents
  (id, org_id, parent_id, title, body, position, default_role, kind,
   created_by, updated_by, created_at, updated_at, deleted_at, deleted_by)
select m.folder_id, p.org_id, p.parent_id, p.title, '', p.position, p.default_role, 'folder',
       p.created_by, p.updated_by, p.created_at, p.updated_at, p.deleted_at, p.deleted_by
from core.kb_documents p
join kb_folder_map m on m.doc_id = p.id;

-- Прежний родитель тоже мог стать листом — тогда папка встаёт в его папку.
update core.kb_documents f
set parent_id = m2.folder_id
from kb_folder_map m1
join core.kb_documents p on p.id = m1.doc_id
join kb_folder_map m2 on m2.doc_id = p.parent_id
where f.id = m1.folder_id;

-- Базовую роль у документа снимаем до переезда: у вложенного её быть не может
-- (kb_documents_role_root_ck), а она уже уехала в папку.
update core.kb_documents d
set default_role = null
from kb_folder_map m
where d.id = m.doc_id;

-- Документ уезжает в свою папку…
update core.kb_documents d
set parent_id = m.folder_id
from kb_folder_map m
where d.id = m.doc_id;

-- …и его прежние дети — туда же, соседями. Выборка идёт по состоянию до
-- предыдущего UPDATE, поэтому каждая строка попадает ровно в одну папку.
update core.kb_documents c
set parent_id = m.folder_id
from kb_folder_map m
where c.parent_id = m.doc_id and c.id <> m.doc_id;

-- Привязки и список доступа принадлежат корню ветки — теперь это папка.
update core.kb_document_projects dp
set document_id = m.folder_id
from kb_folder_map m
where dp.document_id = m.doc_id;

update core.kb_document_members dm
set document_id = m.folder_id
from kb_folder_map m
where dm.document_id = m.doc_id;
