import postgres from "postgres";

/**
 * Замены штатных обработчиков postgres.js — по OID типа.
 *
 * Сопоставление идёт именно по OID, а не по имени ключа: перечислять нужно
 * каждый OID отдельно, иначе builtin-обработчик драйвера остаётся в силе для
 * остальных. Ровно на этом и держались обе ошибки, описанные ниже.
 */
export const PG_TYPES: Record<string, postgres.PostgresType> = {
  // DATE (1082) — «2026-01-01», день без времени и зоны. Типы в TypeScript
  // объявляют такие колонки строками, и код обращается с ними соответственно
  // (`localeCompare`, `slice(0, 10)`, сравнение `<`).
  date: {
    to: 1082,
    from: [1082],
    serialize: (x: unknown) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x)),
    parse: (x: string) => x,
  },
  // TIMESTAMPTZ (1184) — то же правило для отметок времени. Пока данные ходили
  // только через JSON API, `Date` здесь был незаметен: `JSON.stringify`
  // превращал его в ту же ISO-строку. Серверный рендер отдаёт результат выборки
  // прямо в компонент, и `created_at` приезжал объектом туда, где типы обещают
  // строку. Формат намеренно совпадает с `JSON.stringify(Date)` — ответы API от
  // этого не меняются.
  timestamptz: {
    to: 1184,
    from: [1184],
    serialize: (x: unknown) => (x instanceof Date ? x : new Date(x as string)).toISOString(),
    parse: (x: string) => new Date(x).toISOString(),
  },
  // json/jsonb (114/3802) — без этой замены готовый JSON-текст кодируется
  // второй раз. Подробности — у serializeJson.
  json: {
    to: 114,
    from: [114, 3802],
    serialize: serializeJson,
    parse: (x: string) => JSON.parse(x),
  },
};

let client: postgres.Sql | null = null;

/**
 * Сериализация параметра для jsonb-колонки.
 *
 * По всей кодовой базе в `?::jsonb` передаётся уже готовый JSON-текст
 * (`JSON.stringify(...)`). Штатный сериализатор postgres.js — тоже
 * `JSON.stringify`, и он кодирует такую строку второй раз: `'[]'` → `'"[]"'`,
 * в колонке оказывается jsonb-строка вместо массива.
 *
 * Причём срабатывает это не всегда. Драйвер применяет сериализатор по типу
 * параметра, а тип он знает только когда успел сделать Describe: без него
 * значение уходит как текст и `::jsonb` разбирает его правильно. Отсюда
 * «то работает, то нет»: часть строк в базе корректная, часть — двойная.
 *
 * Готовый JSON-текст пропускаем как есть, объект — кодируем. Оба пути
 * драйвера дают один результат.
 */
export function serializeJson(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function getClient(): postgres.Sql {
  if (!client) {
    const url = process.env.DATABASE_POOL_URL || process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_POOL_URL (or DATABASE_URL) is not set");
    }
    client = postgres(url, {
      prepare: false,
      idle_timeout: 20,
      max: 10,
      types: PG_TYPES,
    });
  }
  return client;
}

function convertPlaceholders(query: string): string {
  let i = 0;
  return query.replace(/\?/g, () => `$${++i}`);
}

/** Однострочный фрагмент запроса для текста ошибки. */
function briefly(query: string): string {
  const flat = query.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
}

function flattenParams(query: string, params: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const p of params) {
    if (Array.isArray(p)) out.push(...p);
    else out.push(p);
  }
  // На undefined postgres.js бросает голый UNDEFINED_VALUE: ни запроса, ни номера
  // параметра — по такому логу причину не найти (см. 500-е на приёме приглашения).
  // Отвечаем раньше драйвера и говорим, какой параметр какого запроса не заполнен.
  const i = out.indexOf(undefined);
  if (i !== -1) {
    throw new Error(
      `SQL: параметр $${i + 1} равен undefined (нужен явный null): ${briefly(query)}`,
    );
  }
  return out;
}

export type SqlRow = Record<string, unknown>;
export type SqlRunResult = { changes: number };

export type PreparedStatement<Row = SqlRow> = {
  get: (...params: unknown[]) => Promise<Row | undefined>;
  all: (...params: unknown[]) => Promise<Row[]>;
  run: (...params: unknown[]) => Promise<SqlRunResult>;
};

type Runner = <T = SqlRow>(q: string, p: unknown[]) => Promise<T[]>;

function makePrepared<Row = SqlRow>(runner: Runner, query: string): PreparedStatement<Row> {
  const pgQuery = convertPlaceholders(query);
  return {
    get: async (...params) => {
      const rows = await runner<Row>(pgQuery, flattenParams(pgQuery, params));
      return rows[0];
    },
    all: async (...params) => {
      return await runner<Row>(pgQuery, flattenParams(pgQuery, params));
    },
    run: async (...params) => {
      const rows = (await runner(pgQuery, flattenParams(pgQuery, params))) as unknown as
        (unknown[] & { count?: number });
      // postgres.js returns an array-like result with a `.count` property
      // for INSERT/UPDATE/DELETE without RETURNING (rows.length is 0 in that case).
      const count = typeof rows?.count === "number" ? rows.count : (Array.isArray(rows) ? rows.length : 0);
      return { changes: count };
    },
  };
}

function rootRunner<T>(q: string, p: unknown[]): Promise<T[]> {
  const sql = getClient();
  return sql.unsafe(q, p as never[]) as unknown as Promise<T[]>;
}

export function prepare<Row = SqlRow>(query: string): PreparedStatement<Row> {
  return makePrepared<Row>(rootRunner, query);
}

export async function exec(query: string): Promise<void> {
  const sql = getClient();
  await sql.unsafe(query);
}

export type TxContext = {
  prepare: <Row = SqlRow>(query: string) => PreparedStatement<Row>;
  exec: (query: string) => Promise<void>;
};

export async function transaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
  const sql = getClient();
  const result = await sql.begin(async (tx) => {
    const txRunner: Runner = <U>(q: string, p: unknown[]) =>
      tx.unsafe(q, p as never[]) as unknown as Promise<U[]>;
    const ctx: TxContext = {
      prepare: <Row = SqlRow>(query: string) => makePrepared<Row>(txRunner, query),
      exec: async (query: string) => {
        await tx.unsafe(query);
      },
    };
    return await fn(ctx);
  });
  return result as T;
}
