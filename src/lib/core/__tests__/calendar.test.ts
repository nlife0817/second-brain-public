import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLOT_MINUTES,
  MINUTES_IN_DAY,
  calendarRange,
  dragItem,
  eventItem,
  itemTimeLabel,
  itemsInRange,
  laneCount,
  layoutBars,
  layoutDay,
  minutesOf,
  rangeTitle,
  shiftAnchor,
  slotDraft,
  snapMinutes,
  taskItem,
  timeOf,
  weeksOf,
  type CalendarItem,
} from "../calendar";
import { daysOf } from "../days";
import type { CalendarEventRow, TaskRow } from "../types";

const TODAY = "2026-07-30";

/** Минимальная строка списка: календарь читает из неё даты и завершённость. */
function task(over: Partial<TaskRow>): TaskRow {
  return {
    id: "t1",
    org_id: "o1",
    title: "Задача",
    status_id: null,
    priority: "none",
    start_date: null,
    start_time: null,
    due_date: null,
    due_time: null,
    estimated_minutes: null,
    completed_at: null,
    parent_task_id: null,
    subtask_position: null,
    sprint_id: null,
    sprint_carry_count: 0,
    source: "app",
    created_by: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    assignees: [],
    tags: [],
    placements: [],
    subtask_count: 0,
    subtask_done_count: 0,
    comment_count: 0,
    field_values: {},
    ...over,
  };
}

function event(over: Partial<CalendarEventRow>): CalendarEventRow {
  return {
    id: "e1",
    calendar_id: "c1",
    title: "Встреча",
    description: null,
    location: null,
    all_day: false,
    start_date: null,
    end_date: null,
    starts_at: null,
    ends_at: null,
    status: "confirmed",
    organizer: null,
    html_link: null,
    ...over,
  };
}

/** Полоса на день — самый частый элемент в проверках раскладки. */
function bar(key: string, startDay: string, endDay: string): CalendarItem {
  return {
    key,
    kind: "task",
    id: key,
    title: key,
    bar: true,
    timed: false,
    startDay,
    endDay,
    startMinutes: 0,
    endMinutes: MINUTES_IN_DAY,
    inferredStart: false,
    inferredEnd: false,
    invalid: false,
    color: null,
    done: false,
    overdue: false,
    anchor: "both",
    editable: true,
  };
}

function block(key: string, day: string, startMinutes: number, endMinutes: number): CalendarItem {
  return { ...bar(key, day, day), bar: false, timed: true, startMinutes, endMinutes };
}

describe("окно масштаба", () => {
  it("день — сам день", () => {
    expect(calendarRange("2026-07-30", "day")).toEqual({ from: "2026-07-30", to: "2026-07-30" });
  });

  it("неделя — с понедельника по воскресенье", () => {
    // 30 июля 2026 — четверг.
    expect(calendarRange("2026-07-30", "week")).toEqual({ from: "2026-07-27", to: "2026-08-02" });
  });

  it("месяц раскладывается целыми неделями и начинается с понедельника", () => {
    const range = calendarRange("2026-07-30", "month");
    expect(range.from).toBe("2026-06-29");
    expect(range.to).toBe("2026-08-02");
    expect(daysOf(range).length % 7).toBe(0);
  });

  it("недели окна — строки по семь дней", () => {
    const weeks = weeksOf(calendarRange("2026-07-30", "month"));
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0]).toBe("2026-06-29");
  });
});

describe("переход к соседнему периоду", () => {
  it("день и неделя сдвигаются на сутки и на семь", () => {
    expect(shiftAnchor("2026-07-30", "day", 1)).toBe("2026-07-31");
    expect(shiftAnchor("2026-07-30", "week", -1)).toBe("2026-07-23");
  });

  it("месяц сохраняет число", () => {
    expect(shiftAnchor("2026-07-15", "month", 1)).toBe("2026-08-15");
    expect(shiftAnchor("2026-07-15", "month", -1)).toBe("2026-06-15");
  });

  it("31-е не проваливается через короткий месяц", () => {
    // Наивный «+1 месяц» дал бы 2 марта и перелистнул февраль целиком.
    expect(shiftAnchor("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(shiftAnchor("2026-03-31", "month", -1)).toBe("2026-02-28");
  });

  it("переходит через границу года", () => {
    expect(shiftAnchor("2026-12-15", "month", 1)).toBe("2027-01-15");
  });
});

describe("подпись периода", () => {
  it("месяц и день", () => {
    expect(rangeTitle("2026-07-30", "month")).toBe("Июль 2026");
    expect(rangeTitle("2026-07-30", "day")).toBe("четверг, 30 июля 2026");
  });

  it("неделя внутри одного месяца не повторяет месяц слева", () => {
    expect(rangeTitle("2026-07-22", "week")).toBe("20 — 26 июля 2026");
  });

  it("неделя на стыке месяцев показывает оба", () => {
    expect(rangeTitle("2026-07-30", "week")).toBe("27 июля — 2 августа 2026");
  });

  it("неделя на стыке годов показывает оба года", () => {
    expect(rangeTitle("2026-12-31", "week")).toBe("28 декабря 2026 — 3 января 2027");
  });
});

describe("время", () => {
  it("разбирает и собирает", () => {
    expect(minutesOf("10:30")).toBe(630);
    expect(minutesOf("10:30:00")).toBe(630);
    expect(minutesOf(null)).toBeNull();
    expect(timeOf(630)).toBe("10:30");
    expect(timeOf(0)).toBe("00:00");
  });

  it("прижимает к сетке в четверть часа", () => {
    expect(snapMinutes(607)).toBe(600);
    expect(snapMinutes(613)).toBe(615);
  });
});

describe("задача на полотне", () => {
  it("без дат не попадает", () => {
    expect(taskItem(task({}), TODAY)).toBeNull();
  });

  it("две даты без времени — полоса по дням", () => {
    const item = taskItem(task({ start_date: "2026-07-29", due_date: "2026-07-31" }), TODAY)!;
    expect(item.bar).toBe(true);
    expect(item.timed).toBe(false);
    expect([item.startDay, item.endDay]).toEqual(["2026-07-29", "2026-07-31"]);
  });

  it("один день с временами — блок в часовой сетке", () => {
    const item = taskItem(
      task({ start_date: "2026-07-30", start_time: "10:00", due_date: "2026-07-30", due_time: "11:30" }),
      TODAY,
    )!;
    expect(item.bar).toBe(false);
    expect(item.startMinutes).toBe(600);
    expect(item.endMinutes).toBe(690);
    expect(item.inferredStart).toBe(false);
    expect(item.inferredEnd).toBe(false);
    expect(itemTimeLabel(item)).toBe("10:00 — 11:30");
  });

  it("только время начала — конец выведен и помечен", () => {
    const item = taskItem(task({ start_date: "2026-07-30", start_time: "09:00" }), TODAY)!;
    expect(item.bar).toBe(false);
    expect(item.startMinutes).toBe(540);
    expect(item.endMinutes).toBe(540 + DEFAULT_SLOT_MINUTES);
    expect(item.inferredEnd).toBe(true);
    expect(item.anchor).toBe("start_date");
    // Подпись не придумывает второй край.
    expect(itemTimeLabel(item)).toBe("09:00");
  });

  it("только время срока — начало выведено назад от него", () => {
    const item = taskItem(task({ due_date: "2026-07-30", due_time: "18:00" }), TODAY)!;
    expect(item.startMinutes).toBe(1080 - DEFAULT_SLOT_MINUTES);
    expect(item.endMinutes).toBe(1080);
    expect(item.inferredStart).toBe(true);
    expect(item.anchor).toBe("due_date");
    // Блок стоит в сетке на 17:00–18:00, но обещать началом 17:00 нельзя.
    expect(itemTimeLabel(item)).toBe("до 18:00");
  });

  it("многодневная задача со временем остаётся полосой, но время показывает", () => {
    const item = taskItem(
      task({ start_date: "2026-07-29", start_time: "10:00", due_date: "2026-07-31", due_time: "18:00" }),
      TODAY,
    )!;
    expect(item.bar).toBe(true);
    expect(item.timed).toBe(true);
    expect(itemTimeLabel(item)).toBe("10:00 — 18:00");
  });

  it("у многодневной полосы незаданный край не превращается в полночь", () => {
    // Боевой случай: задача с 22-го по 27-е, время только у срока. Подпись
    // «00:00 — 11:05» обещала бы начало в полночь, которого никто не назначал.
    const onlyDue = taskItem(
      task({ start_date: "2026-07-22", due_date: "2026-07-27", due_time: "11:05" }),
      TODAY,
    )!;
    expect(onlyDue.bar).toBe(true);
    expect(itemTimeLabel(onlyDue)).toBe("до 11:05");

    const onlyStart = taskItem(
      task({ start_date: "2026-07-22", start_time: "09:30", due_date: "2026-07-27" }),
      TODAY,
    )!;
    expect(itemTimeLabel(onlyStart)).toBe("с 09:30");
  });

  it("многодневная полоса без времени вовсе подписи не имеет", () => {
    const item = taskItem(task({ start_date: "2026-07-22", due_date: "2026-07-27" }), TODAY)!;
    expect(item.timed).toBe(false);
    expect(itemTimeLabel(item)).toBeNull();
  });

  it("начало позже срока сводится к одному дню и помечается", () => {
    const item = taskItem(task({ start_date: "2026-08-05", due_date: "2026-07-31" }), TODAY)!;
    expect(item.invalid).toBe(true);
    expect(item.startDay).toBe("2026-07-31");
    expect(item.endDay).toBe("2026-07-31");
  });

  it("время конца раньше времени начала помечается", () => {
    const item = taskItem(
      task({ start_date: "2026-07-30", start_time: "18:00", due_date: "2026-07-30", due_time: "09:00" }),
      TODAY,
    )!;
    expect(item.invalid).toBe(true);
    expect(item.inferredEnd).toBe(true);
    expect(item.endMinutes).toBeGreaterThan(item.startMinutes);
  });

  it("просрочка — незавершённая задача со сроком в прошлом", () => {
    expect(taskItem(task({ due_date: "2026-07-29" }), TODAY)!.overdue).toBe(true);
    expect(
      taskItem(task({ due_date: "2026-07-29", completed_at: "2026-07-29T10:00:00Z" }), TODAY)!.overdue,
    ).toBe(false);
  });
});

describe("внешнее событие", () => {
  it("«весь день» живёт в днях", () => {
    const item = eventItem(event({ all_day: true, start_date: "2026-07-29", end_date: "2026-07-31" }))!;
    expect(item.bar).toBe(true);
    expect(item.editable).toBe(false);
    expect([item.startDay, item.endDay]).toEqual(["2026-07-29", "2026-07-31"]);
  });

  it("событие со временем приводится к местным часам", () => {
    // Считаем от местной зоны исполнителя тестов: важно, что модель берёт
    // именно её, а не UTC из строки.
    const starts = new Date(2026, 6, 30, 10, 0);
    const ends = new Date(2026, 6, 30, 11, 0);
    const item = eventItem(
      event({ starts_at: starts.toISOString(), ends_at: ends.toISOString() }),
    )!;
    expect(item.bar).toBe(false);
    expect(item.startDay).toBe("2026-07-30");
    expect(item.startMinutes).toBe(600);
    expect(item.endMinutes).toBe(660);
  });

  it("конец ровно в полночь остаётся в предыдущем дне", () => {
    const starts = new Date(2026, 6, 30, 22, 0);
    const ends = new Date(2026, 6, 31, 0, 0);
    const item = eventItem(event({ starts_at: starts.toISOString(), ends_at: ends.toISOString() }))!;
    expect(item.startDay).toBe("2026-07-30");
    expect(item.endDay).toBe("2026-07-30");
    expect(item.endMinutes).toBe(MINUTES_IN_DAY);
  });

  it("событие без обеих границ отбрасывается", () => {
    expect(eventItem(event({ starts_at: null, ends_at: null }))).toBeNull();
    expect(eventItem(event({ all_day: true }))).toBeNull();
  });
});

describe("раскладка полос по дорожкам", () => {
  const week = daysOf({ from: "2026-07-27", to: "2026-08-02" });

  it("непересекающиеся полосы делят одну дорожку", () => {
    const laid = layoutBars([bar("a", "2026-07-27", "2026-07-28"), bar("b", "2026-07-30", "2026-07-31")], week);
    expect(laid.map((l) => l.lane)).toEqual([0, 0]);
    expect(laneCount(laid)).toBe(1);
  });

  it("пересекающиеся расходятся по дорожкам", () => {
    const laid = layoutBars([bar("a", "2026-07-27", "2026-07-30"), bar("b", "2026-07-29", "2026-07-31")], week);
    expect(laneCount(laid)).toBe(2);
  });

  it("длинная полоса встаёт выше короткой в тот же день", () => {
    const laid = layoutBars([bar("short", "2026-07-27", "2026-07-27"), bar("long", "2026-07-27", "2026-07-30")], week);
    expect(laid.find((l) => l.item.key === "long")!.lane).toBe(0);
    expect(laid.find((l) => l.item.key === "short")!.lane).toBe(1);
  });

  it("полоса, уходящая за края строки, обрезается и помечается", () => {
    const laid = layoutBars([bar("a", "2026-07-20", "2026-08-10")], week);
    expect(laid[0]).toMatchObject({ offset: 0, span: 7, clippedStart: true, clippedEnd: true });
  });

  it("блоки часовой сетки в полосы не попадают", () => {
    expect(layoutBars([block("b", "2026-07-30", 600, 660)], week)).toEqual([]);
  });

  it("полоса вне строки не попадает вовсе", () => {
    expect(layoutBars([bar("a", "2026-09-01", "2026-09-02")], week)).toEqual([]);
  });
});

describe("раскладка блоков в часовой сетке", () => {
  const day = "2026-07-30";

  it("непересекающиеся занимают всю ширину", () => {
    const laid = layoutDay([block("a", day, 600, 660), block("b", day, 720, 780)], day);
    expect(laid.every((l) => l.columns === 1 && l.column === 0)).toBe(true);
  });

  it("два пересекающихся делят ширину пополам", () => {
    const laid = layoutDay([block("a", day, 600, 720), block("b", day, 660, 780)], day);
    expect(laid.map((l) => l.columns)).toEqual([2, 2]);
    expect(laid.map((l) => l.column).sort()).toEqual([0, 1]);
  });

  it("пересечение транзитивно, но освободившаяся колонка переиспользуется", () => {
    // A 10:00–11:00, B 10:30–11:40, C 11:30–12:40. Группа одна (пересечение
    // транзитивно), но одновременно идут максимум два события, поэтому ширина
    // делится на два, а C встаёт в колонку освободившегося A — как в Google
    // Calendar. Делить на три значило бы оставить треть полотна пустой.
    const laid = layoutDay(
      [block("a", day, 600, 660), block("b", day, 630, 700), block("c", day, 690, 760)],
      day,
    );
    expect(laid.every((l) => l.columns === 2)).toBe(true);
    expect(laid.find((l) => l.item.key === "a")!.column).toBe(0);
    expect(laid.find((l) => l.item.key === "b")!.column).toBe(1);
    expect(laid.find((l) => l.item.key === "c")!.column).toBe(0);
  });

  it("вечерняя группа не ужимает утреннюю", () => {
    const laid = layoutDay(
      [block("m", day, 540, 600), block("e1", day, 1080, 1140), block("e2", day, 1100, 1160)],
      day,
    );
    expect(laid.find((l) => l.item.key === "m")!.columns).toBe(1);
    expect(laid.find((l) => l.item.key === "e1")!.columns).toBe(2);
  });

  it("короткое событие держит место под собой", () => {
    // 10:00–10:05 и 10:10–11:00 по времени не пересекаются, но на экране
    // короткое занимает больше своей длительности — иначе второй блок наедет.
    const laid = layoutDay([block("tiny", day, 600, 605), block("next", day, 610, 660)], day);
    expect(laid.every((l) => l.columns === 2)).toBe(true);
  });

  it("чужой день не попадает", () => {
    expect(layoutDay([block("a", "2026-07-31", 600, 660)], day)).toEqual([]);
  });
});

describe("окно и попадание в него", () => {
  it("отбирает пересекающиеся с окном", () => {
    const items = [bar("in", "2026-07-25", "2026-07-28"), bar("out", "2026-08-10", "2026-08-11")];
    expect(itemsInRange(items, { from: "2026-07-27", to: "2026-08-02" }).map((i) => i.key)).toEqual(["in"]);
  });
});

describe("перетаскивание", () => {
  const twoDay = taskItem(task({ start_date: "2026-07-29", due_date: "2026-07-31" }), TODAY)!;

  it("внешнее событие не двигается", () => {
    const item = eventItem(event({ all_day: true, start_date: "2026-07-29", end_date: "2026-07-29" }))!;
    expect(dragItem(item, "move", { days: 1, minutes: 0 })).toEqual({});
  });

  it("нулевой жест ничего не меняет", () => {
    expect(dragItem(twoDay, "move", { days: 0, minutes: 0 })).toEqual({});
  });

  it("полоса переезжает целиком", () => {
    expect(dragItem(twoDay, "move", { days: 2, minutes: 0 })).toEqual({
      start_date: "2026-07-31",
      due_date: "2026-08-02",
    });
  });

  it("края полосы тянутся по отдельности", () => {
    expect(dragItem(twoDay, "resize-start", { days: -1, minutes: 0 })).toEqual({ start_date: "2026-07-28" });
    expect(dragItem(twoDay, "resize-end", { days: 1, minutes: 0 })).toEqual({ due_date: "2026-08-01" });
  });

  it("полоса не выворачивается наизнанку", () => {
    expect(dragItem(twoDay, "resize-start", { days: 10, minutes: 0 })).toEqual({ start_date: "2026-07-31" });
    expect(dragItem(twoDay, "resize-end", { days: -10, minutes: 0 })).toEqual({ due_date: "2026-07-29" });
  });

  it("задача с одной датой: растягивание заводит вторую", () => {
    const onlyStart = taskItem(task({ start_date: "2026-07-30" }), TODAY)!;
    expect(dragItem(onlyStart, "move", { days: 1, minutes: 0 })).toEqual({ start_date: "2026-07-31" });
    expect(dragItem(onlyStart, "resize-end", { days: 2, minutes: 0 })).toEqual({ due_date: "2026-08-01" });
    expect(dragItem(onlyStart, "resize-start", { days: -2, minutes: 0 })).toEqual({
      start_date: "2026-07-28",
      due_date: "2026-07-30",
    });

    const onlyDue = taskItem(task({ due_date: "2026-07-30" }), TODAY)!;
    expect(dragItem(onlyDue, "move", { days: 1, minutes: 0 })).toEqual({ due_date: "2026-07-31" });
    expect(dragItem(onlyDue, "resize-start", { days: -2, minutes: 0 })).toEqual({ start_date: "2026-07-28" });
    expect(dragItem(onlyDue, "resize-end", { days: 2, minutes: 0 })).toEqual({
      start_date: "2026-07-30",
      due_date: "2026-08-01",
    });
  });

  const timed = taskItem(
    task({ start_date: "2026-07-30", start_time: "10:00", due_date: "2026-07-30", due_time: "11:00" }),
    TODAY,
  )!;

  it("блок переезжает целиком, сохраняя длительность", () => {
    expect(dragItem(timed, "move", { days: 1, minutes: 30 })).toEqual({
      start_date: "2026-07-31",
      start_time: "10:30",
      due_date: "2026-07-31",
      due_time: "11:30",
    });
  });

  it("сдвиг блока прижимается к четверти часа", () => {
    expect(dragItem(timed, "move", { days: 0, minutes: 8 })).toMatchObject({ start_time: "10:15" });
  });

  it("сдвиг мельче половины шага сетки не даёт патча вовсе", () => {
    // Иначе дрожание мыши на пиксель уходило бы на сервер патчем, который
    // ничего не меняет.
    expect(dragItem(timed, "move", { days: 0, minutes: 7 })).toEqual({});
  });

  it("блок, переехавший через полночь, меняет и дату", () => {
    const late = taskItem(
      task({ start_date: "2026-07-30", start_time: "23:00", due_date: "2026-07-30", due_time: "23:30" }),
      TODAY,
    )!;
    expect(dragItem(late, "move", { days: 0, minutes: 90 })).toEqual({
      start_date: "2026-07-31",
      start_time: "00:30",
      due_date: "2026-07-31",
      due_time: "01:00",
    });
  });

  it("края блока тянутся по времени", () => {
    expect(dragItem(timed, "resize-start", { days: 0, minutes: -60 })).toEqual({
      start_date: "2026-07-30",
      start_time: "09:00",
    });
    expect(dragItem(timed, "resize-end", { days: 0, minutes: 60 })).toEqual({
      due_date: "2026-07-30",
      due_time: "12:00",
    });
  });

  it("блок не схлопывается в ноль", () => {
    expect(dragItem(timed, "resize-end", { days: 0, minutes: -600 })).toEqual({
      due_date: "2026-07-30",
      due_time: "10:15",
    });
    expect(dragItem(timed, "resize-start", { days: 0, minutes: 600 })).toEqual({
      start_date: "2026-07-30",
      start_time: "10:45",
    });
  });

  it("перемещение не дописывает выведенный край", () => {
    // У задачи задано только начало: сдвиг блока обязан оставить срок пустым,
    // иначе жест молча назначает длительность, которой никто не задавал.
    const openEnded = taskItem(task({ start_date: "2026-07-30", start_time: "09:00" }), TODAY)!;
    expect(dragItem(openEnded, "move", { days: 0, minutes: 60 })).toEqual({
      start_date: "2026-07-30",
      start_time: "10:00",
    });
  });

  it("растягивание задаёт выведенный край", () => {
    const openEnded = taskItem(task({ start_date: "2026-07-30", start_time: "09:00" }), TODAY)!;
    expect(dragItem(openEnded, "resize-end", { days: 0, minutes: 60 })).toEqual({
      due_date: "2026-07-30",
      due_time: "11:00",
    });
  });

  it("у задачи только со временем срока перемещение не заводит начало", () => {
    const openStart = taskItem(task({ due_date: "2026-07-30", due_time: "18:00" }), TODAY)!;
    expect(dragItem(openStart, "move", { days: 1, minutes: 0 })).toEqual({
      due_date: "2026-07-31",
      due_time: "18:00",
    });
  });
});

describe("черновик из слота", () => {
  it("без времени — однодневная задача", () => {
    expect(slotDraft("2026-07-30", null)).toEqual({
      start_date: "2026-07-30",
      start_time: null,
      due_date: "2026-07-30",
      due_time: null,
    });
  });

  it("протяжка по сетке даёт отрезок", () => {
    expect(slotDraft("2026-07-30", { startMinutes: 600, endMinutes: 690 })).toEqual({
      start_date: "2026-07-30",
      start_time: "10:00",
      due_date: "2026-07-30",
      due_time: "11:30",
    });
  });

  it("протяжка снизу вверх даёт тот же отрезок", () => {
    expect(slotDraft("2026-07-30", { startMinutes: 690, endMinutes: 600 })).toMatchObject({
      start_time: "10:00",
      due_time: "11:30",
    });
  });

  it("клик без протяжки не создаёт пустой отрезок", () => {
    expect(slotDraft("2026-07-30", { startMinutes: 600, endMinutes: 600 })).toMatchObject({
      start_time: "10:00",
      due_time: "10:15",
    });
  });
});
