// MCP поверх Streamable HTTP: разбор JSON-RPC и вызов инструментов.
//
// Сервер намеренно БЕЗ СОСТОЯНИЯ: сессии не заводятся, `Mcp-Session-Id` не
// выдаётся, поток SSE не открывается — каждый запрос это POST с телом JSON-RPC
// и ответ таким же JSON. Спецификация это разрешает, а нам иначе пришлось бы
// держать сессии в памяти процесса, который живёт в контейнере и перезапускается
// на каждом выкате.
//
// Реализация своя, без SDK. Поверхность протокола, которая нам нужна, — это
// initialize, tools/list, tools/call и ping; тянуть ради них зависимость,
// которая ждёт Node-совместимые req/res (а у Next 16 роут получает Web Request),
// дороже, чем сотня строк здесь.

import { z } from "zod";
import { DomainError } from "@/lib/core/http";
import { PolicyError } from "@/lib/core/policy";
import type { AuthContext } from "@/lib/core/types";
import { allTools, findTool } from "./tools";

/** Версии спецификации, которые мы понимаем. Первая — предпочитаемая. */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const SERVER_INFO = {
  name: "second-brain",
  title: "Second Brain — задачи",
  version: "1.0.0",
};

const INSTRUCTIONS = [
  "Трекер задач Second Brain: проекты, задачи, описания-документы, комментарии и вложения.",
  "Действия выполняются правами владельца токена и попадают в историю задачи с пометкой «через Claude» —",
  "их увидит вся команда, поэтому правки должны быть теми, о которых просил пользователь.",
  "Описание задачи читается Markdown'ом, а записывается HTML: чтобы изменить его точечно,",
  "возьми исходник через get_task с include_html и верни правленый документ целиком.",
].join(" ");

// --- JSON-RPC ---------------------------------------------------------------------

const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).nullish(),
  method: z.string(),
  params: z.unknown().optional(),
});

type JsonRpcId = string | number | null;

const ERROR_CODES = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
};

function result(id: JsonRpcId, payload: unknown) {
  return { jsonrpc: "2.0" as const, id, result: payload };
}

function failure(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

// --- Описание инструментов ------------------------------------------------------

/**
 * Схема аргументов в виде JSON Schema. Считается на каждый tools/list, а не
 * один раз на модуль: список зависит от режима токена, и кэш пришлось бы вести
 * по режиму — экономия на списке из полутора десятков схем того не стоит.
 */
function describeTool(tool: (typeof allTools)[number]) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input, { io: "input" }),
    annotations: {
      title: tool.title,
      readOnlyHint: !tool.write,
      destructiveHint: tool.name.startsWith("delete_"),
    },
  };
}

export interface McpSession {
  auth: AuthContext;
  /** Токен только для чтения не видит инструментов правки — и не может их позвать. */
  readOnly: boolean;
}

/** Инструменты, доступные этой сессии. */
function toolsFor(session: McpSession) {
  return session.readOnly ? allTools.filter((t) => !t.write) : allTools;
}

// --- Обработка ---------------------------------------------------------------------

async function callTool(session: McpSession, params: unknown) {
  const parsed = z
    .object({ name: z.string(), arguments: z.unknown().optional() })
    .safeParse(params);
  if (!parsed.success) return { error: "tools/call: нужен name" };

  const tool = findTool(parsed.data.name);
  if (!tool) return { error: `Инструмент ${parsed.data.name} не найден` };
  if (tool.write && session.readOnly) {
    return { error: "Токен выдан только на чтение — изменить данные им нельзя" };
  }

  const args = tool.input.safeParse(parsed.data.arguments ?? {});
  if (!args.success) {
    const details = args.error.issues.map((i) => `${i.path.join(".") || "аргументы"}: ${i.message}`).join("; ");
    return { error: `Неверные аргументы — ${details}` };
  }

  // Отказ доменного слоя — это ответ инструмента, а не сбой протокола: модель
  // должна прочитать причину и исправиться, а isError на уровне JSON-RPC
  // клиенты показывают как поломку соединения.
  try {
    return { reply: await (tool.handler as (ctx: AuthContext, a: unknown) => Promise<unknown>)(session.auth, args.data) };
  } catch (err) {
    if (err instanceof DomainError) return { error: `${err.status}: ${err.message}` };
    if (err instanceof PolicyError) return { error: `Недостаточно прав: ${err.message}` };
    console.error("[mcp] инструмент упал:", parsed.data.name, err);
    return { error: "Внутренняя ошибка при выполнении инструмента" };
  }
}

/**
 * Один запрос JSON-RPC → ответ, либо null для уведомления (у него нет id, и
 * отвечать на него нельзя).
 */
export async function handleRpc(session: McpSession, message: unknown): Promise<object | null> {
  const parsed = requestSchema.safeParse(message);
  if (!parsed.success) return failure(null, ERROR_CODES.invalidRequest, "Некорректный запрос JSON-RPC");
  const { id = null, method, params } = parsed.data;
  const isNotification = id === null || id === undefined;

  switch (method) {
    case "initialize": {
      const requested = (params as { protocolVersion?: string } | undefined)?.protocolVersion;
      // Отвечаем версией клиента, если знаем её, иначе своей новейшей —
      // клиент вправе на этом разорвать связь, и это честнее молчаливого
      // расхождения.
      const version =
        requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0];
      return result(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, { tools: toolsFor(session).map(describeTool) });

    case "tools/call": {
      const outcome = await callTool(session, params);
      if ("error" in outcome) {
        return result(id, { content: [{ type: "text", text: outcome.error }], isError: true });
      }
      return result(id, outcome.reply);
    }

    // Ресурсов и промптов сервер не объявляет: клиенты всё равно спрашивают
    // список, и пустой ответ им понятнее ошибки «метода нет».
    case "resources/list":
      return result(id, { resources: [] });
    case "prompts/list":
      return result(id, { prompts: [] });

    default:
      if (isNotification) return null;
      return failure(id, ERROR_CODES.methodNotFound, `Метод ${method} не поддерживается`);
  }
}

/** Тело запроса (одиночное или пакет) → тело ответа или null, если отвечать нечем. */
export async function handleMessage(session: McpSession, body: unknown): Promise<unknown | null> {
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handleRpc(session, m)))).filter(
      (r): r is object => r !== null,
    );
    return replies.length > 0 ? replies : null;
  }
  return handleRpc(session, body);
}

export { ERROR_CODES, SUPPORTED_PROTOCOL_VERSIONS };
