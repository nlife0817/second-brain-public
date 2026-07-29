// Чистая логика напоминаний: когда наступает повод, как он именуется и что
// человек прочитает в уведомлении. Всё, что зависит от времени, проверяется
// здесь — в рантайме ошибку такого рода видно только через сутки.

import { describe, expect, it } from "vitest";
import {
  digestDue,
  dueOffsetMinutes,
  localNow,
  reminderFor,
  reminderSlot,
  reminderText,
  type ReminderTask,
} from "../reminders";
import { isQuietNow, DEFAULT_DELIVERY } from "../notification-settings";
import { isTaskMuted } from "../notification-prefs";

function task(partial: Partial<ReminderTask> = {}): ReminderTask {
  return {
    taskId: "11111111-1111-1111-1111-111111111111",
    orgId: "22222222-2222-2222-2222-222222222222",
    title: "Отчёт",
    dueDate: "2026-07-30",
    dueTime: "18:00",
    ...partial,
  };
}

describe("localNow", () => {
  it("переводит момент в местные дату и время", () => {
    // 2026-07-30T12:00:00Z = 19:00 в Новосибирске (UTC+7).
    const now = new Date("2026-07-30T12:00:00Z");
    expect(localNow(now, "Asia/Novosibirsk")).toEqual({ date: "2026-07-30", minutes: 19 * 60 });
    expect(localNow(now, "UTC")).toEqual({ date: "2026-07-30", minutes: 12 * 60 });
  });

  it("учитывает переход через полночь в местном поясе", () => {
    // 22:30 UTC = 05:30 следующего дня в Новосибирске.
    const now = new Date("2026-07-30T22:30:00Z");
    expect(localNow(now, "Asia/Novosibirsk")).toEqual({ date: "2026-07-31", minutes: 5 * 60 + 30 });
  });

  it("полночь — это ноль минут, а не 1440", () => {
    const now = new Date("2026-07-30T17:00:00Z"); // 00:00 31-го в Новосибирске
    expect(localNow(now, "Asia/Novosibirsk")).toEqual({ date: "2026-07-31", minutes: 0 });
  });
});

describe("reminderFor", () => {
  it("предупреждает за полчаса до срока со временем", () => {
    expect(reminderFor(task(), { date: "2026-07-30", minutes: 17 * 60 + 35 })).toBe("due_soon");
  });

  it("молчит, пока до срока далеко", () => {
    expect(reminderFor(task(), { date: "2026-07-30", minutes: 12 * 60 })).toBeNull();
  });

  it("после наступления срока говорит о просрочке, а не о «скоро»", () => {
    expect(reminderFor(task(), { date: "2026-07-30", minutes: 18 * 60 + 1 })).toBe("overdue");
  });

  it("задача без времени просрочена только после конца своего дня", () => {
    const noTime = task({ dueTime: null });
    // Днём того же дня — ещё не просрочена и не «скоро»: она в утренней сводке.
    expect(reminderFor(noTime, { date: "2026-07-30", minutes: 23 * 60 + 59 })).toBeNull();
    expect(reminderFor(noTime, { date: "2026-07-31", minutes: 0 })).toBe("overdue");
  });

  it("предупреждение работает и через полночь", () => {
    const earlyTomorrow = task({ dueDate: "2026-07-31", dueTime: "00:15" });
    expect(reminderFor(earlyTomorrow, { date: "2026-07-30", minutes: 23 * 60 + 50 })).toBe("due_soon");
  });

  it("давняя просрочка остаётся просрочкой, а не теряется", () => {
    const old = task({ dueDate: "2026-07-01" });
    expect(reminderFor(old, { date: "2026-07-30", minutes: 10 * 60 })).toBe("overdue");
  });
});

describe("dueOffsetMinutes", () => {
  it("считает срок относительно полуночи сегодняшнего дня", () => {
    expect(dueOffsetMinutes(task(), "2026-07-30")).toBe(18 * 60);
    expect(dueOffsetMinutes(task(), "2026-07-29")).toBe(1440 + 18 * 60);
    expect(dueOffsetMinutes(task({ dueTime: null }), "2026-07-30")).toBe(1440);
  });
});

describe("reminderSlot", () => {
  it("один повод — один ключ, независимо от момента запуска", () => {
    expect(reminderSlot(task(), "due_soon")).toBe(reminderSlot(task(), "due_soon"));
  });

  it("разные типы и разные сроки — разные ключи", () => {
    expect(reminderSlot(task(), "due_soon")).not.toBe(reminderSlot(task(), "overdue"));
    expect(reminderSlot(task(), "overdue")).not.toBe(
      reminderSlot(task({ dueDate: "2026-08-01" }), "overdue"),
    );
  });
});

describe("digestDue", () => {
  it("наступает в свой час", () => {
    expect(digestDue({ date: "2026-07-30", minutes: 9 * 60 }, 9)).toBe(true);
  });

  it("догоняет пропущенный тик в пределах трёх часов", () => {
    expect(digestDue({ date: "2026-07-30", minutes: 11 * 60 + 59 }, 9)).toBe(true);
  });

  it("не приходит ночью и не приходит вечером вместо утра", () => {
    expect(digestDue({ date: "2026-07-30", minutes: 8 * 60 + 59 }, 9)).toBe(false);
    expect(digestDue({ date: "2026-07-30", minutes: 15 * 60 }, 9)).toBe(false);
  });
});

describe("reminderText", () => {
  it("одна задача названа по имени", () => {
    expect(reminderText("overdue", [task()]).body).toBe("«Отчёт» просрочена");
  });

  it("несколько задач сворачиваются в одну строку с числом", () => {
    const many = [task(), task({ taskId: "b", title: "Смета" }), task({ taskId: "c", title: "Звонок" })];
    const text = reminderText("due_soon", many);
    expect(text.body).toContain("3 задачи");
    expect(text.body).toContain("«Отчёт»");
  });

  it("длинный список обрезается, а остаток считается", () => {
    const many = Array.from({ length: 6 }, (_, i) => task({ taskId: String(i), title: `Задача ${i}` }));
    expect(reminderText("overdue", many).body).toContain("и ещё 3");
  });

  it("сводка сообщает и о сегодняшних, и о просроченных", () => {
    const text = reminderText("digest", [task()], 2);
    expect(text.title).toBe("Задачи на сегодня");
    expect(text.body).toContain("1 задача со сроком сегодня");
    expect(text.body).toContain("2 просрочены");
  });
});

describe("isQuietNow", () => {
  const quiet = { ...DEFAULT_DELIVERY, quiet_enabled: true, quiet_start: "22:00", quiet_end: "08:00" };

  it("окно через полночь захватывает и вечер, и утро", () => {
    expect(isQuietNow(quiet, "23:30")).toBe(true);
    expect(isQuietNow(quiet, "03:00")).toBe(true);
    expect(isQuietNow(quiet, "07:59")).toBe(true);
    expect(isQuietNow(quiet, "08:00")).toBe(false);
    expect(isQuietNow(quiet, "12:00")).toBe(false);
  });

  it("обычное дневное окно работает по границам", () => {
    const day = { ...quiet, quiet_start: "13:00", quiet_end: "14:00" };
    expect(isQuietNow(day, "13:00")).toBe(true);
    expect(isQuietNow(day, "13:59")).toBe(true);
    expect(isQuietNow(day, "14:00")).toBe(false);
  });

  it("выключенные тихие часы и пустое окно не глушат ничего", () => {
    expect(isQuietNow({ ...quiet, quiet_enabled: false }, "23:30")).toBe(false);
    expect(isQuietNow({ ...quiet, quiet_start: "08:00", quiet_end: "08:00" }, "08:00")).toBe(false);
  });
});

describe("isTaskMuted", () => {
  it("задача молчит, только если заглушены все её проекты", () => {
    expect(isTaskMuted(["p1"], new Set(["p1"]))).toBe(true);
    expect(isTaskMuted(["p1", "p2"], new Set(["p1"]))).toBe(false);
    expect(isTaskMuted(["p1", "p2"], new Set(["p1", "p2"]))).toBe(true);
  });

  it("задача без проектов не заглушается", () => {
    expect(isTaskMuted([], new Set(["p1"]))).toBe(false);
  });

  it("нет заглушённых проектов — нет и фильтра", () => {
    expect(isTaskMuted(["p1"], undefined)).toBe(false);
    expect(isTaskMuted(["p1"], new Set())).toBe(false);
  });
});
