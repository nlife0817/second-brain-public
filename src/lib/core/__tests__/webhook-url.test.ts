import { describe, expect, it } from "vitest";
import { isPublicHttpsUrl, signPayload } from "../saas";

describe("isPublicHttpsUrl: защита доставки вебхуков от внутренней сети", () => {
  it("пропускает обычные https-адреса", () => {
    expect(isPublicHttpsUrl("https://example.com/hook")).toBe(true);
    expect(isPublicHttpsUrl("https://hooks.slack.com/services/T/B/X")).toBe(true);
  });

  it("отклоняет http и другие схемы", () => {
    expect(isPublicHttpsUrl("http://example.com")).toBe(false);
    expect(isPublicHttpsUrl("file:///etc/passwd")).toBe(false);
    expect(isPublicHttpsUrl("не ссылка")).toBe(false);
  });

  it("отклоняет метаданные облака и локальные адреса", () => {
    for (const url of [
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/hook",
      "https://127.0.0.1:8080/hook",
      "https://10.1.2.3/hook",
      "https://192.168.0.10/hook",
      "https://172.16.0.5/hook",
      "https://172.31.255.1/hook",
      "https://db.internal/hook",
      "https://service.local/hook",
      "https://[::1]/hook",
    ]) {
      expect(isPublicHttpsUrl(url), url).toBe(false);
    }
  });

  it("не путает похожие публичные адреса с приватными диапазонами", () => {
    // 172.32.x уже вне приватного диапазона 172.16–172.31
    expect(isPublicHttpsUrl("https://172.32.0.1/hook")).toBe(true);
    expect(isPublicHttpsUrl("https://localhost.example.com/hook")).toBe(true);
  });
});

describe("signPayload", () => {
  it("детерминирован и зависит от секрета", () => {
    const body = '{"verb":"task.created"}';
    expect(signPayload("s1", body)).toBe(signPayload("s1", body));
    expect(signPayload("s1", body)).not.toBe(signPayload("s2", body));
  });
});
