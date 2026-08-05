// Правила спринта. Живут в двух местах сразу — в сервисе (sprints.ts) и в
// интерфейсе (диалоги старта, завершения и переезда), поэтому расхождение
// выглядело бы так: диалог обещает одно, сервер делает другое.

import { describe, expect, it } from "vitest";
import {
  carryDefault,
  daysLeft,
  dueBeforeSprintEnd,
  isInsideSprint,
  nextSprintDraft,
  nextSprintName,
  shiftTaskDates,
  shouldShiftDates,
  sprintLoad,
  sprintStartBlock,
} from "../sprint-model";
import type { Sprint, SprintState } from "../types";

function sprint(id: string, state: SprintState, over: Partial<Sprint> = {}): Sprint {
  return {
    id,
    org_id: "org",
    project_id: "p1",
    name: id,
    goal: "",
    starts_on: "2026-08-04",
    ends_on: "2026-08-17",
    state,
    capacity_minutes: 2400,
    position: 1,
    started_at: null,
    completed_at: null,
    created_by: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("sprintStartBlock", () => {
  it("запланированный при отсутствии активного — можно", () => {
    const list = [sprint("s1", "completed"), sprint("s2", "planned")];
    expect(sprintStartBlock(list, "s2")).toBeNull();
  });

  it("второй активный не заводится", () => {
    const list = [sprint("s1", "active"), sprint("s2", "planned")];
    expect(sprintStartBlock(list, "s2")).toBe("other_active");
  });

  it("завершённый заново не начинают", () => {
    const list = [sprint("s1", "completed")];
    expect(sprintStartBlock(list, "s1")).toBe("not_planned");
  });
});

describe("carryDefault: куда уходит незакрытая задача", () => {
  it("начатая едет в следующий спринт", () => {
    expect(carryDefault("in_progress")).toBe("sprint");
  });

  it("не начатая возвращается в бэклог", () => {
    expect(carryDefault("backlog")).toBe("backlog");
    expect(carryDefault(undefined)).toBe("backlog");
  });
});

describe("сроки при переезде", () => {
  const from = sprint("s1", "active", { starts_on: "2026-08-04", ends_on: "2026-08-17" });
  const to = sprint("s2", "planned", { starts_on: "2026-08-18", ends_on: "2026-08-31" });

  it("дата внутри окна считается планом и едет", () => {
    expect(isInsideSprint("2026-08-14", from)).toBe(true);
    expect(shouldShiftDates({ start_date: null, due_date: "2026-08-14" }, from)).toBe(true);
  });

  it("дата вне окна — чужая договорённость, по умолчанию не двигается", () => {
    expect(shouldShiftDates({ start_date: null, due_date: "2026-09-30" }, from)).toBe(false);
    expect(shouldShiftDates({ start_date: null, due_date: "2026-08-14" }, null)).toBe(false);
  });

  it("сдвиг идёт дельтой между началами, а не «на конец спринта»", () => {
    // 14 авг. — одиннадцатый день старого спринта; дельта 14 дней.
    expect(shiftTaskDates({ start_date: "2026-08-05", due_date: "2026-08-14" }, from, to)).toEqual({
      start_date: "2026-08-19",
      due_date: "2026-08-28",
    });
  });

  it("вылезающая за конец дата прижимается к последнему дню", () => {
    const shortTo = sprint("s3", "planned", { starts_on: "2026-08-18", ends_on: "2026-08-24" });
    expect(shiftTaskDates({ start_date: null, due_date: "2026-08-17" }, from, shortTo).due_date).toBe(
      "2026-08-24",
    );
  });

  it("из бэклога срок не выдумывается, а пустому ставится конец спринта", () => {
    expect(shiftTaskDates({ start_date: null, due_date: "2026-09-01" }, null, to).due_date).toBe(
      "2026-09-01",
    );
    expect(shiftTaskDates({ start_date: null, due_date: null }, null, to).due_date).toBe("2026-08-31");
  });

  it("конфликт: срок наступает раньше конца нового спринта", () => {
    expect(dueBeforeSprintEnd({ start_date: null, due_date: "2026-08-20" }, to)).toBe(true);
    expect(dueBeforeSprintEnd({ start_date: null, due_date: "2026-09-05" }, to)).toBe(false);
    expect(dueBeforeSprintEnd({ start_date: null, due_date: null }, to)).toBe(false);
  });
});

describe("ёмкость", () => {
  it("перегруз виден, остаток не уходит в минус", () => {
    const load = sprintLoad({ estimated_minutes: 2700, capacity_minutes: 2400 });
    expect(load.over).toBe(true);
    expect(load.remaining).toBe(0);
  });

  it("без ёмкости — только сумма", () => {
    const load = sprintLoad({ estimated_minutes: 600, capacity_minutes: null });
    expect(load.ratio).toBeNull();
    expect(load.over).toBe(false);
  });
});

describe("оставшиеся дни", () => {
  it("последний день спринта — это ещё один день, а не ноль", () => {
    expect(daysLeft({ ends_on: "2026-08-17" }, "2026-08-17")).toBe(1);
    expect(daysLeft({ ends_on: "2026-08-17" }, "2026-08-14")).toBe(4);
  });

  it("просроченный спринт показывает минус, а не ноль", () => {
    expect(daysLeft({ ends_on: "2026-08-17" }, "2026-08-20")).toBe(-2);
    expect(daysLeft({ ends_on: null }, "2026-08-20")).toBeNull();
  });
});

describe("черновик следующего спринта", () => {
  it("продолжает предыдущий той же длины со следующим номером", () => {
    const prev = sprint("s1", "active", { name: "Спринт 14", starts_on: "2026-08-04", ends_on: "2026-08-17" });
    expect(nextSprintDraft(prev, "2026-08-10")).toEqual({
      name: "Спринт 15",
      starts_on: "2026-08-18",
      ends_on: "2026-08-31",
    });
  });

  it("первый спринт начинается сегодня и длится две недели", () => {
    expect(nextSprintDraft(undefined, "2026-08-05")).toEqual({
      name: "Спринт 1",
      starts_on: "2026-08-05",
      ends_on: "2026-08-18",
    });
  });

  it("имя без номера получает второй", () => {
    expect(nextSprintName("Релиз осени")).toBe("Релиз осени 2");
    expect(nextSprintName("Итерация 9")).toBe("Итерация 10");
  });
});
