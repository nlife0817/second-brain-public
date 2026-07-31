import { describe, expect, it } from "vitest";
import { handleMessage, handleRpc, type McpSession } from "../server";
import { allTools, findTool } from "../tools";
import type { AuthContext } from "@/lib/core/types";

// Контекст-заглушка: до базы ни один из проверяемых здесь методов не доходит —
// tools/list и разбор аргументов работают с описанием инструмента, а не с ним.
const auth = {
  user: { id: "u1", email: "vitya@example.com", name: "Витя" },
  orgId: "o1",
  orgRole: "owner",
  projectRoles: new Map(),
} as unknown as AuthContext;

const full: McpSession = { auth, readOnly: false };
const readOnly: McpSession = { auth, readOnly: true };

function rpc(method: string, params?: unknown, id: number | string | null = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

describe("реестр инструментов", () => {
  it("имена уникальны", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("каждый инструмент описан для модели", () => {
    for (const t of allTools) {
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(findTool(t.name)).toBe(t);
    }
  });

  // Список инструментов — это единственное, по чему модель решает, что делать:
  // забытый флаг write откроет мутацию токену «только на чтение».
  it("мутации помечены флагом write", () => {
    const mutating = ["create_task", "update_task", "add_comment", "delete_task", "manage_statuses"];
    for (const name of mutating) expect(findTool(name)?.write, name).toBe(true);
    for (const name of ["get_task", "list_tasks", "search", "whoami"]) {
      expect(findTool(name)?.write, name).toBeFalsy();
    }
  });
});

describe("протокол", () => {
  it("initialize отвечает версией клиента, если она знакома", async () => {
    const res = (await handleRpc(full, rpc("initialize", { protocolVersion: "2025-03-26" }))) as {
      result: { protocolVersion: string; serverInfo: { name: string }; instructions: string };
    };
    expect(res.result.protocolVersion).toBe("2025-03-26");
    expect(res.result.serverInfo.name).toBe("second-brain");
    expect(res.result.instructions).toContain("через Claude");
  });

  it("на незнакомую версию отвечает своей", async () => {
    const res = (await handleRpc(full, rpc("initialize", { protocolVersion: "1999-01-01" }))) as {
      result: { protocolVersion: string };
    };
    expect(res.result.protocolVersion).toBe("2025-06-18");
  });

  it("уведомление ответа не имеет", async () => {
    expect(await handleRpc(full, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("tools/list отдаёт схемы аргументов", async () => {
    const res = (await handleRpc(full, rpc("tools/list"))) as {
      result: { tools: Array<{ name: string; inputSchema: { type: string; properties?: object } }> };
    };
    expect(res.result.tools.length).toBe(allTools.length);
    const getTask = res.result.tools.find((t) => t.name === "get_task");
    expect(getTask?.inputSchema.type).toBe("object");
    expect(getTask?.inputSchema.properties).toHaveProperty("task_id");
  });

  it("токен только на чтение не видит инструментов правки", async () => {
    const res = (await handleRpc(readOnly, rpc("tools/list"))) as { result: { tools: Array<{ name: string }> } };
    const names = res.result.tools.map((t) => t.name);
    expect(names).toContain("get_task");
    expect(names).not.toContain("update_task");
  });

  it("и не может их позвать в обход списка", async () => {
    const res = (await handleRpc(readOnly, rpc("tools/call", { name: "delete_task", arguments: { task_id: "x" } }))) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("только на чтение");
  });

  // Неверные аргументы — это ответ инструмента, а не сбой соединения: модель
  // должна прочитать причину и исправиться.
  it("неверные аргументы возвращаются текстом ошибки", async () => {
    const res = (await handleRpc(full, rpc("tools/call", { name: "get_task", arguments: { task_id: "не-uuid" } }))) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("task_id");
  });

  it("незнакомый инструмент — тоже ответ, а не разрыв", async () => {
    const res = (await handleRpc(full, rpc("tools/call", { name: "выключить_прод" }))) as {
      result: { isError: boolean };
    };
    expect(res.result.isError).toBe(true);
  });

  it("незнакомый метод — ошибка JSON-RPC", async () => {
    const res = (await handleRpc(full, rpc("resources/subscribe"))) as { error: { code: number } };
    expect(res.error.code).toBe(-32601);
  });

  it("пакет запросов отвечает пакетом без уведомлений", async () => {
    const batch = await handleMessage(full, [
      rpc("ping", undefined, 1),
      { jsonrpc: "2.0", method: "notifications/initialized" },
      rpc("ping", undefined, 2),
    ]);
    expect(Array.isArray(batch) && batch.length).toBe(2);
  });
});
