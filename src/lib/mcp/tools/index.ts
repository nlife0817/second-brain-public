// Реестр инструментов. Один список на весь сервер: имена в нём уникальны, и
// проверяет это тест — совпавшее имя молча перекрыло бы чужой инструмент.

import type { McpTool } from "../types";
import { adminTools } from "./admin";
import { readTools } from "./read";
import { writeTools } from "./write";

export const allTools: McpTool[] = [...readTools, ...writeTools, ...adminTools];

const byName = new Map(allTools.map((t) => [t.name, t]));

export function findTool(name: string): McpTool | undefined {
  return byName.get(name);
}
