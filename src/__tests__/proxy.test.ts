// Proxy решает судьбу каждого запроса до того, как до него доберётся приложение,
// и ошибка здесь не видна ни в одном юнит-тесте роутов. Тесты фиксируют разбор
// адресов: что живо, что отвечает 410 и куда уезжает неавторизованный.
//
// Главный сторож — вход: `/api/auth/*` появился после отключения v1 и однажды
// уже попал под общее правило «всё вне /api/v2 — наследие», из-за чего войти
// стало невозможно.

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

// Байпас включается при NODE_ENV !== "production" и заданном DEV_USER_EMAIL —
// в тестах первое условие выполнено всегда, второе снимаем явно.
delete process.env.DEV_USER_EMAIL;

const { proxy, config } = await import("../proxy");

const ORIGIN = "https://brain.example.com";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, ORIGIN), { headers });
}

describe("живые API", () => {
  it("пропускает вход по паролю", async () => {
    const response = await proxy(request("/api/auth/login"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("пропускает выход", async () => {
    const response = await proxy(request("/api/auth/logout"));
    expect(response.status).toBe(200);
  });

  // Оба роута работают до входа: у их запросов сессии нет по определению.
  it("пропускает установку пароля и регистрацию по приглашению", async () => {
    for (const path of ["/api/auth/set-password", "/api/auth/invite-signup"]) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(200);
    }
  });

  it("не подменяет вход даже мобильному браузеру", async () => {
    const response = await proxy(request("/api/auth/login", { "user-agent": MOBILE_UA }));
    expect(response.status).toBe(200);
  });

  // MCP-сервер ходит по токену, а не по сессии: попади он под matcher — запрос
  // уехал бы редиректом на /login, и до проверки токена дело бы не дошло.
  it("не перехватывает MCP: путь исключён из matcher", () => {
    const [pattern] = config.matcher;
    expect(new RegExp(`^${pattern}$`).test("/api/mcp")).toBe(false);
    expect(new RegExp(`^${pattern}$`).test("/api/v2/me")).toBe(true);
  });
});

describe("наследие v1", () => {
  it("отвечает 410 на старые API", async () => {
    // `/api/mcp` в этом списке был, но вернулся к жизни как MCP-сервер v2.
    for (const path of ["/api/cron/daily", "/api/notifications/dispatch", "/api/timing/watchdog"]) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(410);
    }
  });

  it("уводит старые страницы в v2", async () => {
    const response = await proxy(request("/timing"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/v2/time`);
  });

  it("уводит старые страницы мобильного браузера в мобильный v2", async () => {
    const response = await proxy(request("/", { "user-agent": MOBILE_UA }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/v2/m/my`);
  });
});

describe("сессия", () => {
  it("отправляет неавторизованного на вход с возвратом", async () => {
    const response = await proxy(request("/v2/m/my"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?next=%2Fv2%2Fm%2Fmy`);
  });

  it("пускает на страницу входа", async () => {
    const response = await proxy(request("/login?next=%2Fv2%2Fm%2Fmy"));
    expect(response.status).toBe(200);
  });

  // Сюда приходит ровно тот, кто войти пока не может: отправить его на /login
  // значило бы замкнуть круг.
  it("пускает на установку пароля по ссылке", async () => {
    const response = await proxy(request("/set-password/abc123"));
    expect(response.status).toBe(200);
  });

  it("требует сессию для API v2", async () => {
    const response = await proxy(request("/api/v2/me"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?next=%2Fapi%2Fv2%2Fme`);
  });
});
