// MCP-сервер трекера: единственная точка входа для внешних агентов.
//
// Вход по персональному токену (`Authorization: Bearer sb_…`), выпущенному в
// настройках организации. Сессии-cookie здесь нет, поэтому путь исключён из
// `config.matcher` в proxy.ts — иначе запрос получил бы 307 на /login и до кода
// не дошёл бы (см. правило про публичные endpoint'ы в CLAUDE.md).
//
// Всё, что делает агент, помечается источником `claude`: `runAs` оборачивает
// обработку целиком, и событие любой мутации — включая написанные позже — уедет
// в ленту с этой пометкой.

import { NextResponse, after } from "next/server";
import { resolveTokenAuth, touchApiToken } from "@/lib/core/api-tokens";
import { runAs } from "@/lib/core/actor-source";
import { dispatchPendingPush } from "@/lib/core/push";
import { handleMessage } from "@/lib/mcp/server";

// postgres.js и node:crypto — рантайм только Node.
export const runtime = "nodejs";
// Ответ зависит от заголовка и тела запроса; кэшировать нечего.
export const dynamic = "force-dynamic";

const UNAUTHORIZED = {
  jsonrpc: "2.0",
  id: null,
  error: { code: -32001, message: "Нужен действующий токен: Authorization: Bearer sb_…" },
};

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const token = bearer(request);
  if (!token) {
    return NextResponse.json(UNAUTHORIZED, {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  const resolved = await resolveTokenAuth(token);
  if (!resolved) {
    return NextResponse.json(UNAUTHORIZED, {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Тело запроса — не JSON" } },
      { status: 400 },
    );
  }

  const response = await runAs("claude", () =>
    handleMessage(
      { auth: resolved.auth, readOnly: resolved.scope === "read" },
      body,
    ),
  );

  // Отметка использования и push уходят после ответа: первое — подсказка в
  // списке токенов, второе — та же мгновенная доставка, что делает withOrg
  // после каждой мутации через интерфейс.
  after(async () => {
    try {
      await touchApiToken(resolved.tokenId);
      await dispatchPendingPush();
    } catch (err) {
      console.error("[mcp] пост-обработка не удалась:", err);
    }
  });

  // Уведомление JSON-RPC ответа не имеет: по спецификации это 202 с пустым телом.
  if (response === null) return new NextResponse(null, { status: 202 }) as NextResponse;
  return NextResponse.json(response);
}

/**
 * Поток «сервер → клиент» мы не открываем: сервер без состояния, посылать в
 * такой поток нечего. Явный 405 понятнее оборванного соединения.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "Method Not Allowed: MCP этого сервера работает только через POST" },
    { status: 405, headers: { Allow: "POST" } },
  );
}
