// Чистые правила базы знаний: дерево, перестановка узлов и склейка версий.
// Без БД и без AuthContext — всё, что нужно решению, приходит аргументами.
// Права живут в policy.ts, работа с данными — в kb.ts.

import { isEmptyWorkbook, parseWorkbook } from "./sheet/model";
import type { KbNodeKind, KbTreeNode } from "./types";

/** Строка дерева в том виде, в каком её отдаёт выборка. */
export interface KbNodeRow {
  id: string;
  kind: KbNodeKind;
  parent_id: string | null;
  title: string;
  position: number;
  created_at: string;
  /** Право правки: у ветки оно общее и считается на её корне. */
  can_edit: boolean;
}

/**
 * Плоский список → дерево.
 *
 * Сирота (родитель не попал в выборку — его снесли в корзину или он невидим)
 * поднимается в корень, а не пропадает: потерянная ветка выглядит как пропажа
 * документов, а корень читается как «лежит не на своём месте».
 *
 * Порядок соседей — `position`, `created_at` разводит равные: позиции в базе
 * бывают разъехавшимися, и без второго ключа порядок скакал бы между запросами.
 */
export function buildKbTree(rows: KbNodeRow[]): KbTreeNode[] {
  const byId = new Map<string, KbTreeNode>();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      kind: row.kind,
      parent_id: row.parent_id,
      title: row.title,
      position: row.position,
      can_edit: row.can_edit,
      children: [],
    });
  }

  const order = new Map(rows.map((r) => [r.id, r.created_at]));
  const roots: KbTreeNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else {
      // Сирота встаёт в корень, но признак родителя не теряет: интерфейс
      // покажет её там, где она видна, а не там, где её нет.
      roots.push(node);
    }
  }

  // Папки идут перед документами: раздел, спрятанный между страницами,
  // читается как потерянный. Внутри вида — позиция, `created_at` разводит
  // равные (позиции в базе бывают и разъехавшимися).
  const sort = (list: KbTreeNode[]) => {
    list.sort(
      (a, b) =>
        kindRank(a.kind) - kindRank(b.kind) ||
        a.position - b.position ||
        (order.get(a.id) ?? "").localeCompare(order.get(b.id) ?? "") ||
        a.id.localeCompare(b.id),
    );
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

/** Папки впереди документов — один порядок у дерева и у страницы папки. */
export function kindRank(kind: KbNodeKind): number {
  return kind === "folder" ? 0 : 1;
}

/**
 * Собрать id поддерева, включая корень. Нужен и удалению (корзина уносит ветку
 * целиком), и проверке перемещения: узел нельзя положить внутрь себя.
 */
export function collectSubtree(rows: KbNodeRow[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const list = children.get(row.parent_id);
    if (list) list.push(row.id);
    else children.set(row.parent_id, [row.id]);
  }
  const out: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    // Цикл в родителях — данные битые, но обход обязан завершиться.
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return out;
}

/** Путь от корня ветки до узла включительно — хлебные крошки. */
export function pathToRoot(
  rows: Array<{ id: string; parent_id: string | null; title: string; kind: KbNodeKind }>,
  documentId: string,
): Array<{ id: string; title: string; kind: KbNodeKind }> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const path: Array<{ id: string; title: string; kind: KbNodeKind }> = [];
  const seen = new Set<string>();
  let current = byId.get(documentId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift({ id: current.id, title: current.title, kind: current.kind });
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return path;
}

/** Название, которое получает только что созданный документ или папка. */
export const UNTITLED = "Без названия";

/**
 * Пуст ли документ настолько, что его не жалко убрать.
 *
 * Документ заводится одним нажатием «плюса», и передумать — обычное дело:
 * человек создал, посмотрел и ушёл. Такие пустышки копятся в дереве и мешают
 * находить настоящее. Признак строгий: и заголовок не тронут, и текста нет, и
 * ничего к нему не привязано — иначе уборка однажды унесёт чужую работу.
 *
 * Разметка пустого редактора это не пустая строка: Tiptap отдаёт `<p></p>`.
 */
export function isDisposableDocument(input: {
  kind: KbNodeKind;
  title: string;
  body: string;
  /** Вложения, обсуждения, связанные задачи, версии, дети — что угодно из этого. */
  hasContent: boolean;
}): boolean {
  // Папку не трогаем никогда: она пуста ровно до того, как в неё что-то
  // положат, и убрать её значит отменить осознанное действие.
  if (input.kind === "folder") return false;
  if (input.hasContent) return false;
  const title = input.title.trim();
  if (title !== "" && title !== UNTITLED) return false;
  // Пустая книга — та, где нет ни одной заполненной ячейки и один лист:
  // заведённый второй лист это уже осознанная работа.
  if (input.kind === "sheet") return isEmptyWorkbook(parseWorkbook(input.body));
  return input.body.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "") === "";
}

/**
 * Порядок соседей приходит целиком, как справочник статусов и порядок проектов:
 * перетаскивание сдвигает соседей, и патч одной позиции оставил бы список в
 * промежуточном состоянии между запросами.
 *
 * Позиции нормализуются в 1..N: `double precision` здесь только запас на
 * будущую вставку между соседями, а не носитель истории перестановок.
 */
export function normalizeOrder(order: string[]): Array<{ id: string; position: number }> {
  return order.map((id, i) => ({ id, position: i + 1 }));
}

/** Окно склейки версий: правки одного автора подряд не плодят строк истории. */
export const VERSION_SQUASH_MS = 10 * 60 * 1000;

export interface LastVersion {
  id: string;
  author_id: string | null;
  updated_at: string;
}

/**
 * Дописать правку в последнюю версию или завести новую.
 *
 * Автосохранение шлёт документ раз в полторы секунды: без склейки история за
 * один сеанс работы превращалась бы в сотни неотличимых строк. Склеиваем
 * только правки того же автора и только внутри окна — чужая правка обязана
 * стать отдельной точкой возврата, иначе восстановить «как было до Ивана»
 * нельзя.
 */
export function shouldSquashVersion(
  last: LastVersion | null,
  authorId: string | null,
  now: Date,
  windowMs: number = VERSION_SQUASH_MS,
): boolean {
  if (!last) return false;
  if (last.author_id !== authorId) return false;
  const at = Date.parse(last.updated_at);
  if (Number.isNaN(at)) return false;
  return now.getTime() - at < windowMs;
}

/**
 * Стоит ли вообще писать версию: пустая правка (тот же текст и заголовок)
 * истории не добавляет. Сравнение строковое и этого достаточно — тело уже
 * прошло санитайзер, то есть приведено к каноническому виду.
 */
export function isMeaningfulRevision(
  previous: { title: string; body: string },
  next: { title: string; body: string },
): boolean {
  return previous.title !== next.title || previous.body !== next.body;
}
