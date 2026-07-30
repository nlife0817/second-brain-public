import { describe, expect, it } from "vitest";
import { parseIcs } from "../ics";

const WINDOW = { from: "2026-07-01", to: "2026-09-30" };

/** Обёртка календаря: тесты пишут только интересные им VEVENT. */
function ics(body: string, head = ""): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//RU", head, body, "END:VCALENDAR"]
    .filter(Boolean)
    .join("\r\n");
}

describe("одиночные события", () => {
  it("событие со временем в UTC", () => {
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:one@test",
          "SUMMARY:Созвон",
          "DTSTART:20260730T070000Z",
          "DTEND:20260730T080000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      WINDOW,
    );
    expect(cal.events).toHaveLength(1);
    expect(cal.events[0]).toMatchObject({
      externalId: "one@test",
      title: "Созвон",
      allDay: false,
      startsAt: "2026-07-30T07:00:00.000Z",
      endsAt: "2026-07-30T08:00:00.000Z",
    });
  });

  it("событие с TZID переводится в момент по зоне", () => {
    // Москва летом — UTC+3 круглый год, поэтому 10:00 это 07:00Z.
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:tz@test",
          "DTSTART;TZID=Europe/Moscow:20260730T100000",
          "DTEND;TZID=Europe/Moscow:20260730T113000",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      WINDOW,
    );
    expect(cal.events[0].startsAt).toBe("2026-07-30T07:00:00.000Z");
    expect(cal.events[0].endsAt).toBe("2026-07-30T08:30:00.000Z");
  });

  it("зона с переходом на летнее время считается по своему смещению", () => {
    // Берлин: летом UTC+2 (10:00 → 08:00Z), зимой UTC+1 (10:00 → 09:00Z).
    const summer = parseIcs(
      ics(
        ["BEGIN:VEVENT", "UID:s@t", "DTSTART;TZID=Europe/Berlin:20260730T100000", "END:VEVENT"].join("\r\n"),
      ),
      WINDOW,
    );
    const winter = parseIcs(
      ics(
        ["BEGIN:VEVENT", "UID:w@t", "DTSTART;TZID=Europe/Berlin:20260130T100000", "END:VEVENT"].join("\r\n"),
      ),
      { from: "2026-01-01", to: "2026-02-01" },
    );
    expect(summer.events[0].startsAt).toBe("2026-07-30T08:00:00.000Z");
    expect(winter.events[0].startsAt).toBe("2026-01-30T09:00:00.000Z");
  });

  it("событие «весь день» — дни включительно, конец DTEND исключительный", () => {
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:allday@test",
          "SUMMARY:Отпуск",
          "DTSTART;VALUE=DATE:20260803",
          "DTEND;VALUE=DATE:20260808",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      WINDOW,
    );
    expect(cal.events[0]).toMatchObject({
      allDay: true,
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      startsAt: null,
    });
  });

  it("однодневное «весь день» без DTEND занимает один день", () => {
    const cal = parseIcs(
      ics(["BEGIN:VEVENT", "UID:d@t", "DTSTART;VALUE=DATE:20260803", "END:VEVENT"].join("\r\n")),
      WINDOW,
    );
    expect(cal.events[0]).toMatchObject({ allDay: true, startDate: "2026-08-03", endDate: "2026-08-03" });
  });

  it("DURATION вместо DTEND", () => {
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:dur@t",
          "DTSTART:20260730T070000Z",
          "DURATION:PT1H30M",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      WINDOW,
    );
    expect(cal.events[0].endsAt).toBe("2026-07-30T08:30:00.000Z");
  });

  it("события вне окна отбрасываются", () => {
    const cal = parseIcs(
      ics(["BEGIN:VEVENT", "UID:old@t", "DTSTART:20200101T070000Z", "END:VEVENT"].join("\r\n")),
      WINDOW,
    );
    expect(cal.events).toHaveLength(0);
  });

  it("многодневное событие, начавшееся до окна, в окно попадает", () => {
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:span@t",
          "DTSTART;VALUE=DATE:20260625",
          "DTEND;VALUE=DATE:20260705",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      WINDOW,
    );
    expect(cal.events).toHaveLength(1);
  });
});

describe("лексика формата", () => {
  it("развёрнутые строки склеиваются без лишнего пробела", () => {
    // RFC 5545: продолжение отмечается одним пробелом, и этот пробел снимается,
    // а не превращается в разделитель — значащий пробел выгрузка ставит в конце
    // предыдущей строки. Добавить его от себя значит испортить каждое
    // перенесённое название.
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:fold@t",
          "SUMMARY:Очень длинное название ",
          " продолжается здесь",
          "DTSTART:20260730T070000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      WINDOW,
    );
    expect(cal.events[0].title).toBe("Очень длинное название продолжается здесь");
  });

  it("экранирование текста снимается", () => {
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:esc@t",
          "SUMMARY:Отчёт\\, версия 2",
          "DESCRIPTION:Первая строка\\nВторая\\; и точка с запятой",
          "DTSTART:20260730T070000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      WINDOW,
    );
    expect(cal.events[0].title).toBe("Отчёт, версия 2");
    expect(cal.events[0].description).toBe("Первая строка\nВторая; и точка с запятой");
  });

  it("двоеточие внутри кавычек параметра не рвёт строку", () => {
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:q@t",
          'ORGANIZER;CN="Иванов: начальник":mailto:boss@test.ru',
          "DTSTART:20260730T070000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      WINDOW,
    );
    expect(cal.events[0].organizer).toBe("Иванов: начальник");
  });

  it("имя и зона календаря читаются из X-WR-*", () => {
    const cal = parseIcs(
      ics(
        ["BEGIN:VEVENT", "UID:n@t", "DTSTART:20260730T070000Z", "END:VEVENT"].join("\r\n"),
        ["X-WR-CALNAME:Рабочий", "X-WR-TIMEZONE:Europe/Moscow"].join("\r\n"),
      ),
      WINDOW,
    );
    expect(cal.name).toBe("Рабочий");
    expect(cal.timezone).toBe("Europe/Moscow");
  });

  it("плавающее время считается в зоне календаря", () => {
    const cal = parseIcs(
      ics(
        ["BEGIN:VEVENT", "UID:float@t", "DTSTART:20260730T100000", "END:VEVENT"].join("\r\n"),
        "X-WR-TIMEZONE:Europe/Moscow",
      ),
      WINDOW,
    );
    expect(cal.events[0].startsAt).toBe("2026-07-30T07:00:00.000Z");
  });

  it("VALARM внутри события не путается со самим событием", () => {
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:alarm@t",
          "SUMMARY:Со напоминанием",
          "DTSTART:20260730T070000Z",
          "BEGIN:VALARM",
          "TRIGGER:-PT15M",
          "SUMMARY:Не это название",
          "END:VALARM",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      WINDOW,
    );
    expect(cal.events).toHaveLength(1);
    expect(cal.events[0].title).toBe("Со напоминанием");
  });

  it("VTODO событием не считается", () => {
    const cal = parseIcs(
      ics(["BEGIN:VTODO", "UID:todo@t", "DTSTART:20260730T070000Z", "END:VTODO"].join("\r\n")),
      WINDOW,
    );
    expect(cal.events).toHaveLength(0);
    expect(cal.skipped).toBeGreaterThan(0);
  });
});

describe("повторы", () => {
  const daily = (extra: string[] = []) =>
    parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:rec@t",
          "SUMMARY:Планёрка",
          "DTSTART:20260706T060000Z",
          "DTEND:20260706T063000Z",
          ...extra,
          "END:VEVENT",
        ].join("\r\n"),
      ),
      { from: "2026-07-06", to: "2026-07-20" },
    );

  it("ежедневно с интервалом", () => {
    const cal = daily(["RRULE:FREQ=DAILY;INTERVAL=3"]);
    expect(cal.events.map((e) => e.startsAt?.slice(0, 10))).toEqual([
      "2026-07-06",
      "2026-07-09",
      "2026-07-12",
      "2026-07-15",
      "2026-07-18",
    ]);
  });

  it("COUNT ограничивает серию", () => {
    const cal = daily(["RRULE:FREQ=DAILY;COUNT=2"]);
    expect(cal.events).toHaveLength(2);
  });

  it("UNTIL ограничивает серию", () => {
    const cal = daily(["RRULE:FREQ=DAILY;UNTIL=20260708T235959Z"]);
    expect(cal.events.map((e) => e.startsAt?.slice(0, 10))).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
    ]);
  });

  it("еженедельно по дням недели", () => {
    // 6 июля 2026 — понедельник.
    const cal = daily(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"]);
    expect(cal.events.map((e) => e.startsAt?.slice(0, 10))).toEqual([
      "2026-07-06",
      "2026-07-08",
      "2026-07-13",
      "2026-07-15",
      "2026-07-20",
    ]);
  });

  it("еженедельно через неделю", () => {
    const cal = daily(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"]);
    expect(cal.events.map((e) => e.startsAt?.slice(0, 10))).toEqual(["2026-07-06", "2026-07-20"]);
  });

  it("EXDATE убирает экземпляр", () => {
    const cal = daily(["RRULE:FREQ=DAILY;COUNT=3", "EXDATE:20260707T060000Z"]);
    expect(cal.events.map((e) => e.startsAt?.slice(0, 10))).toEqual(["2026-07-06", "2026-07-08"]);
  });

  it("экземпляры серии получают разные id", () => {
    const cal = daily(["RRULE:FREQ=DAILY;COUNT=3"]);
    expect(new Set(cal.events.map((e) => e.externalId)).size).toBe(3);
  });

  it("монтируется только внутри окна, а COUNT считается от начала серии", () => {
    // Серия из пяти дней начинается до окна: в окно попадают только последние.
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:pre@t",
          "DTSTART:20260701T060000Z",
          "RRULE:FREQ=DAILY;COUNT=5",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      { from: "2026-07-04", to: "2026-07-31" },
    );
    expect(cal.events.map((e) => e.startsAt?.slice(0, 10))).toEqual(["2026-07-04", "2026-07-05"]);
  });

  it("месячно по числу", () => {
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:m@t",
          "DTSTART:20260715T060000Z",
          "RRULE:FREQ=MONTHLY",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      { from: "2026-07-01", to: "2026-10-01" },
    );
    expect(cal.events.map((e) => e.startsAt?.slice(0, 10))).toEqual([
      "2026-07-15",
      "2026-08-15",
      "2026-09-15",
    ]);
  });

  it("месячно по порядковому дню недели", () => {
    // Второй вторник каждого месяца.
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:mo@t",
          "DTSTART:20260714T060000Z",
          "RRULE:FREQ=MONTHLY;BYDAY=2TU",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      { from: "2026-07-01", to: "2026-09-30" },
    );
    expect(cal.events.map((e) => e.startsAt?.slice(0, 10))).toEqual([
      "2026-07-14",
      "2026-08-11",
      "2026-09-08",
    ]);
  });

  it("месячно по последней пятнице", () => {
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:last@t",
          "DTSTART:20260731T060000Z",
          "RRULE:FREQ=MONTHLY;BYDAY=-1FR",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      { from: "2026-07-01", to: "2026-09-30" },
    );
    expect(cal.events.map((e) => e.startsAt?.slice(0, 10))).toEqual([
      "2026-07-31",
      "2026-08-28",
      "2026-09-25",
    ]);
  });

  it("ежегодно", () => {
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:y@t",
          "SUMMARY:День рождения",
          "DTSTART;VALUE=DATE:20200812",
          "RRULE:FREQ=YEARLY",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      { from: "2026-07-01", to: "2026-09-30" },
    );
    expect(cal.events.map((e) => e.startDate)).toEqual(["2026-08-12"]);
  });

  it("RECURRENCE-ID переопределяет один экземпляр", () => {
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:ovr@t",
          "SUMMARY:Планёрка",
          "DTSTART:20260706T060000Z",
          "DTEND:20260706T063000Z",
          "RRULE:FREQ=DAILY;COUNT=3",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "UID:ovr@t",
          "SUMMARY:Планёрка перенесена",
          "RECURRENCE-ID:20260707T060000Z",
          "DTSTART:20260707T090000Z",
          "DTEND:20260707T093000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      { from: "2026-07-06", to: "2026-07-20" },
    );
    const moved = cal.events.find((e) => e.title === "Планёрка перенесена");
    expect(cal.events).toHaveLength(3);
    expect(moved?.startsAt).toBe("2026-07-07T09:00:00.000Z");
    // Исходный экземпляр того же дня остаться не должен.
    expect(cal.events.filter((e) => e.startsAt?.startsWith("2026-07-07"))).toHaveLength(1);
  });

  it("отменённое переопределение убирает экземпляр", () => {
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:can@t",
          "DTSTART:20260706T060000Z",
          "RRULE:FREQ=DAILY;COUNT=3",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "UID:can@t",
          "RECURRENCE-ID:20260707T060000Z",
          "DTSTART:20260707T060000Z",
          "STATUS:CANCELLED",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      { from: "2026-07-06", to: "2026-07-20" },
    );
    expect(cal.events.map((e) => e.startsAt?.slice(0, 10))).toEqual(["2026-07-06", "2026-07-08"]);
  });

  it("бесконечная серия ограничена окном, а не падает", () => {
    const cal = parseIcs(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:inf@t",
          "DTSTART:20200101T060000Z",
          "RRULE:FREQ=DAILY",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      { from: "2026-07-01", to: "2026-07-31" },
    );
    expect(cal.events).toHaveLength(31);
  });
});

describe("устойчивость", () => {
  it("пустой текст не роняет разбор", () => {
    expect(parseIcs("", WINDOW).events).toEqual([]);
  });

  it("мусор вместо календаря не роняет разбор", () => {
    expect(parseIcs("<html>404 not found</html>", WINDOW).events).toEqual([]);
  });

  it("событие без DTSTART отбрасывается", () => {
    const cal = parseIcs(ics(["BEGIN:VEVENT", "UID:no@t", "SUMMARY:Без даты", "END:VEVENT"].join("\r\n")), WINDOW);
    expect(cal.events).toEqual([]);
    expect(cal.skipped).toBe(1);
  });

  it("событие без UID отбрасывается: по нему нечем опознать строку", () => {
    const cal = parseIcs(
      ics(["BEGIN:VEVENT", "SUMMARY:Безымянное", "DTSTART:20260730T070000Z", "END:VEVENT"].join("\r\n")),
      WINDOW,
    );
    expect(cal.events).toEqual([]);
  });
});
