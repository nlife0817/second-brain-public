// Чистые части телеграм-канала: разбор команд бота и сборка текста сообщения.
//
// Обе ошибки, которые здесь ловятся, в рантайме выглядят одинаково — «бот
// молчит». Незакрытая разметка роняет отправку с «can't parse entities», а
// неузнанная команда уводит привязку в справку.

import { describe, expect, it } from "vitest";
import { parseCommand } from "../telegram";
import { escapeHtml, formatMessage } from "@/lib/notifications/telegram";

describe("parseCommand", () => {
  it("разбирает команду с аргументом", () => {
    expect(parseCommand("/start AbC-123_xyz")).toEqual({
      command: "start",
      argument: "AbC-123_xyz",
    });
  });

  it("отбрасывает имя бота: так телеграм адресует команду в группе", () => {
    expect(parseCommand("/start@second_brainalerts_bot code42")).toEqual({
      command: "start",
      argument: "code42",
    });
  });

  it("команда без аргумента даёт пустой аргумент, а не null", () => {
    expect(parseCommand("/stop")).toEqual({ command: "stop", argument: "" });
  });

  it("приводит регистр команды", () => {
    expect(parseCommand("/START")?.command).toBe("start");
  });

  it("обычный текст командой не считается", () => {
    expect(parseCommand("привет")).toBeNull();
    expect(parseCommand("")).toBeNull();
  });

  it("переживает лишние пробелы вокруг", () => {
    expect(parseCommand("  /start   code  ")).toEqual({ command: "start", argument: "code" });
  });
});

describe("formatMessage", () => {
  it("заголовок полужирный, тело следующей строкой", () => {
    expect(formatMessage({ title: "Новый комментарий", body: "Иван: привет" })).toBe(
      "<b>Новый комментарий</b>\nИван: привет",
    );
  });

  it("без заголовка — только тело: служебные ответы бота идут без шапки", () => {
    expect(formatMessage({ body: "Готово" })).toBe("Готово");
  });

  it("экранирует разметку в названии задачи", () => {
    // Без этого «can't parse entities» роняет отправку целиком, и уведомления
    // пропадают у всех, кому в пачку попала такая задача.
    expect(formatMessage({ title: "Задача", body: 'Проверить <div class="a"> в шапке' })).toBe(
      "<b>Задача</b>\nПроверить &lt;div class=\"a\"&gt; в шапке",
    );
  });

  it("экранирует амперсанд до угловых скобок", () => {
    expect(escapeHtml("A & <b>")).toBe("A &amp; &lt;b&gt;");
  });

  it("пустое тело не оставляет висящий перенос строки", () => {
    expect(formatMessage({ title: "Проверка", body: "   " })).toBe("<b>Проверка</b>");
  });

  it("режет длинное тело до потолка sendMessage", () => {
    const text = formatMessage({ title: "Задачи на сегодня", body: "я".repeat(5000) });
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text.endsWith("…")).toBe(true);
  });

  it("не разрубает html-сущность посередине", () => {
    // «&lt» без точки с запятой телеграм не разберёт — и отправка упадёт ровно
    // там, где обрезка должна была её спасти. Угловая скобка стоит так, чтобы
    // её «&lt;» пришлось ровно на место реза.
    const body = `${"я".repeat(3996)}<div>${"x".repeat(100)}`;
    const text = formatMessage({ body });
    expect(text.length).toBeLessThanOrEqual(4000);
    // После обрезки хвоста-многоточия не должно остаться начатой сущности.
    expect(/&[a-z]*$/.test(text.slice(0, -1))).toBe(false);
    expect(text.endsWith("…")).toBe(true);
  });
});
