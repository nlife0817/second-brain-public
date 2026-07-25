import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { PolicyError } from "./policy";

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Мусорный id должен давать 404 до похода в Postgres (иначе uuid-каст → 500). */
export function isUuid(value: string | undefined | null): value is string {
  return !!value && UUID_RE.test(value);
}

/** Валидация тела запроса. Возвращает [data, null] либо [null, готовый 400-ответ]. */
export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<[T, null] | [null, NextResponse]> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return [null, jsonError(400, "Invalid JSON body")];
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first.path.length ? `${first.path.join(".")}: ` : "";
    return [null, jsonError(400, `${path}${first.message}`)];
  }
  return [parsed.data, null];
}

/** Перевод доменных ошибок в HTTP. Использовать в catch роутов. */
export function toHttpError(err: unknown): NextResponse {
  if (err instanceof PolicyError) return jsonError(403, err.message);
  if (err instanceof DomainError) return jsonError(err.status, err.message);
  console.error("api/v2 unhandled error:", err);
  return jsonError(500, "Internal error");
}

/** Ошибка доменного слоя с HTTP-статусом (404, 409, 422…). */
export class DomainError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "DomainError";
  }
}
