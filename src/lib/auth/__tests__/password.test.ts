// Пароль — единственное, что теперь стоит между посторонним и данными
// организации: у входа больше нет Google, который проверял бы личность за нас.

import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../password";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "../password-rules";

describe("хеширование", () => {
  it("принимает верный пароль и отвергает неверный", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterz", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("даёт разный хеш одному паролю: соль случайна", async () => {
    const [a, b] = await Promise.all([hashPassword("одинаковый пароль"), hashPassword("одинаковый пароль")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("одинаковый пароль", a)).toBe(true);
    expect(await verifyPassword("одинаковый пароль", b)).toBe(true);
  });

  it("не хранит пароль в открытом виде", async () => {
    const hash = await hashPassword("секретное слово");
    expect(hash).not.toContain("секретное");
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  // Экран входа не должен падать пятисоткой из-за чужой записи в колонке:
  // «не подошёл» — единственный правильный ответ на любую непонятную строку.
  it("считает битый и пустой хеш непрошедшим, а не ошибкой", async () => {
    for (const stored of [null, "", "не хеш вовсе", "scrypt$", "bcrypt$2b$10$whatever", "scrypt$x$y$z$q$w"]) {
      expect(await verifyPassword("любой пароль", stored), String(stored)).toBe(false);
    }
  });
});

describe("требования к паролю", () => {
  it("отвергает короткий и принимает достаточный", () => {
    expect(passwordProblem("a".repeat(PASSWORD_MIN_LENGTH - 1))).not.toBeNull();
    expect(passwordProblem("a".repeat(PASSWORD_MIN_LENGTH))).toBeNull();
  });

  // Верхняя граница — не придирчивость, а защита: scrypt считает от длины входа.
  it("отвергает пароль неограниченной длины", () => {
    expect(passwordProblem("a".repeat(10_000))).not.toBeNull();
  });
});
