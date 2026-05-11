import postgres from "postgres";

let client: postgres.Sql | null = null;

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
      types: {
        // DATE (OID 1082) — keep as ISO string ("2026-01-01"), not JS Date.
        // The TS types declare these columns as `string`; code does .localeCompare,
        // .slice(0,10) etc on them. Without this override pg.js returns Date and
        // serverside sorts/comparisons crash with TypeError.
        date: {
          to: 1082,
          from: [1082],
          serialize: (x: unknown) =>
            x instanceof Date ? x.toISOString().slice(0, 10) : String(x),
          parse: (x: string) => x,
        },
      },
    });
  }
  return client;
}

function convertPlaceholders(query: string): string {
  let i = 0;
  return query.replace(/\?/g, () => `$${++i}`);
}

function flattenParams(params: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const p of params) {
    if (Array.isArray(p)) out.push(...p);
    else out.push(p);
  }
  return out;
}

export type SqlRow = Record<string, unknown>;
export type SqlRunResult = { changes: number; lastInsertRowid?: number | string };

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
      const rows = await runner<Row>(pgQuery, flattenParams(params));
      return rows[0];
    },
    all: async (...params) => {
      return await runner<Row>(pgQuery, flattenParams(params));
    },
    run: async (...params) => {
      const rows = (await runner(pgQuery, flattenParams(params))) as unknown as
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
