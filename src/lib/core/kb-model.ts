// Чистые правила базы знаний: дерево, перестановка узлов и склейка версий.
// Без БД и без AuthContext — всё, что нужно решению, приходит аргументами.
// Права живут в policy.ts, работа с данными — в kb.ts.

import type { KbTreeNode } from "./types";

/** Строка дерева в том виде, в каком её отдаёт выборка. */
export interface KbNodeRow {
  id: string;
  parent_id: string | null;
  title: string;
  position: number;
  created_at: string;
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
      parent_id: row.parent_id,
      title: row.title,
      position: row.position,
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

  const sort = (list: KbTreeNode[]) => {
    list.sort(
      (a, b) =>
        a.position - b.position ||
        (order.get(a.id) ?? "").localeCompare(order.get(b.id) ?? "") ||
        a.id.localeCompare(b.id),
    );
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
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

/** Путь от корня ветки до документа включительно — хлебные крошки. */
export function pathToRoot(
  rows: Array<{ id: string; parent_id: string | null; title: string }>,
  documentId: string,
): Array<{ id: string; title: string }> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const path: Array<{ id: string; title: string }> = [];
  const seen = new Set<string>();
  let current = byId.get(documentId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift({ id: current.id, title: current.title });
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return path;
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
