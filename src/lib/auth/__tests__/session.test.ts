// Сессия — единственный рубеж между «залогинен» и «нет», и подписывается она
// вручную. Тесты фиксируют то, что при правке легко сломать молча: подделка
// подписи, подмена payload, истечение срока и очистка ?next.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.SESSION_SECRET = "test-secret-не-короче-настоящего-0123456789";

import {
  shouldRenew,
  signSession,
  toSessionUser,
  verifySession,
  verifySessionPayload,
  type SessionUser,
} from "../session";
import { safeNextPath } from "../urls";
import { utf8ToBase64Url } from "../base64url";

const USER: SessionUser = {
  id: "109876543210987654321",
  email: "user@example.com",
  fullName: "Тестовый Пользователь",
};

const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => {
  // Ключ импортируется лениво и кэшируется — секрет должен быть задан заранее.
  expect(process.env.SESSION_SECRET).toBeTruthy();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("signSession / verifySession", () => {
  it("возвращает того же пользователя", async () => {
    const cookie = await signSession(USER);
    await expect(verifySession(cookie)).resolves.toEqual(USER);
  });

  it("отвергает подделанную подпись", async () => {
    const cookie = await signSession(USER);
    const [body] = cookie.split(".");
    await expect(verifySession(`${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`))
      .resolves.toBeNull();
  });

  it("отвергает подменённый payload при сохранённой подписи", async () => {
    const cookie = await signSession(USER);
    const signature = cookie.slice(cookie.lastIndexOf(".") + 1);
    const forged = utf8ToBase64Url(
      JSON.stringify({ ...USER, email: "attacker@example.com", exp: 4102444800 }),
    );
    await expect(verifySession(`${forged}.${signature}`)).resolves.toBeNull();
  });

  it("отвергает пустое и мусорное значение", async () => {
    await expect(verifySession(undefined)).resolves.toBeNull();
    await expect(verifySession("")).resolves.toBeNull();
    await expect(verifySession("не-cookie")).resolves.toBeNull();
    await expect(verifySession(".")).resolves.toBeNull();
  });

  it("отвергает cookie с истёкшим сроком", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const cookie = await signSession(USER);

    // Срок жизни — 30 дней; на 31-й cookie уже не должна пускать.
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z").getTime() + 31 * DAY);
    await expect(verifySession(cookie)).resolves.toBeNull();
  });
});

describe("shouldRenew", () => {
  it("не продлевает свежую сессию", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const payload = await verifySessionPayload(await signSession(USER));
    expect(payload).not.toBeNull();
    expect(shouldRenew(payload!)).toBe(false);
  });

  it("продлевает, когда прошло больше двух третей срока", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const cookie = await signSession(USER);

    vi.setSystemTime(new Date("2026-01-01T00:00:00Z").getTime() + 25 * DAY);
    const payload = await verifySessionPayload(cookie);
    expect(payload).not.toBeNull();
    expect(shouldRenew(payload!)).toBe(true);
  });
});

describe("toSessionUser", () => {
  it("не тащит служебный exp в подписываемый профиль", async () => {
    const payload = await verifySessionPayload(await signSession(USER));
    expect(toSessionUser(payload!)).toEqual(USER);
    expect(Object.keys(toSessionUser(payload!))).not.toContain("exp");
  });
});

describe("safeNextPath", () => {
  it("пропускает относительные пути", () => {
    expect(safeNextPath("/v2/my")).toBe("/v2/my");
    expect(safeNextPath("/v2/my?task=abc")).toBe("/v2/my?task=abc");
  });

  it("отсекает всё, что уводит на чужой origin", () => {
    // "//evil.com" в new URL(next, origin) даёт https://evil.com
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("https://evil.com")).toBe("/");
    // Обратный слэш браузеры нормализуют в прямой ещё до разбора адреса.
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
  });

  it("подставляет корень вместо пустого значения", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });
});
