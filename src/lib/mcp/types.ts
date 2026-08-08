// Каркас инструментов MCP: описание инструмента и то, чем он отвечает.
//
// Инструмент — тонкая обёртка над доменным слоем: разобрать аргументы (zod) и
// позвать сервис из lib/core. Своего SQL и своих проверок прав здесь нет и быть
// не может: policy остаётся единственным источником правил (см. lib/core/CLAUDE.md),
// а MCP — просто ещё один вход, наравне с REST-роутами.

import { z } from "zod";
import type { AuthContext } from "@/lib/core/types";

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolReply {
  content: ToolContent[];
  /** Машинная копия ответа: клиент вправе читать её вместо текста. */
  structuredContent?: Record<string, unknown>;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  input: z.ZodType;
  /**
   * Меняет данные. Токен режима `read` до таких инструментов не допускается — и
   * не видит их в списке: инструмент, который всегда отвечает отказом, модель
   * будет пробовать снова и снова.
   */
  write?: boolean;
  handler: (ctx: AuthContext, args: never) => Promise<ToolReply>;
}

/** Ответ данными. Текст — тот же JSON: клиенты MCP читают именно текстовый блок. */
export function reply(data: unknown): ToolReply {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const structured =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { result: data };
  return { content: [{ type: "text", text }], structuredContent: structured };
}

/** Объявление инструмента с выводом типа аргументов из его схемы. */
export function tool<S extends z.ZodType>(spec: {
  name: string;
  title: string;
  description: string;
  input: S;
  write?: boolean;
  handler: (ctx: AuthContext, args: z.infer<S>) => Promise<ToolReply>;
}): McpTool {
  return spec as McpTool;
}

/** Общие куски схем: uuid встречается почти в каждом инструменте. */
export const uuid = z.string().uuid();
