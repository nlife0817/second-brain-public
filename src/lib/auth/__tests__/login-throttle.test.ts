// Без ограничения попыток пароль из десяти символов подбирается перебором с
// одного адреса за вечер. Счётчик живёт в памяти процесса, поэтому тесты
// разводят ключи — общего состояния между ними нет.

import { describe, expect, it } from "vitest";
import { clearAttempts, clientIp, recordFailure, throttleRetryAfter } from "../login-throttle";

describe("счётчик попыток", () => {
  it("молчит до предела и запирает после", () => {
    const key = "limit@example.com|10.0.0.1";
    for (let i = 0; i < 10; i++) {
      expect(throttleRetryAfter(key), `попытка ${i + 1}`).toBeNull();
      recordFailure(key);
    }
    expect(throttleRetryAfter(key)).toBeGreaterThan(0);
  });

  // Иначе один человек, промахнувшийся мимо раскладки, остаётся запертым до
  // конца окна, хотя следующим вводом попал верно.
  it("успешный вход снимает счётчик", () => {
    const key = "reset@example.com|10.0.0.2";
    for (let i = 0; i < 12; i++) recordFailure(key);
    expect(throttleRetryAfter(key)).toBeGreaterThan(0);
    clearAttempts(key);
    expect(throttleRetryAfter(key)).toBeNull();
  });

  it("считает адреса раздельно: чужие промахи не запирают", () => {
    const mine = "a@example.com|10.0.0.3";
    const theirs = "b@example.com|10.0.0.3";
    for (let i = 0; i < 12; i++) recordFailure(theirs);
    expect(throttleRetryAfter(mine)).toBeNull();
  });
});

describe("адрес клиента", () => {
  // Приложение стоит за Caddy: без разбора заголовка все попытки приходят с
  // одного внутреннего адреса и счётчик становится общим на всю организацию.
  it("берёт первый адрес из x-forwarded-for", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientIp(request)).toBe("203.0.113.7");
  });

  it("не падает без заголовков", () => {
    expect(clientIp(new Request("https://example.com"))).toBe("unknown");
  });
});
