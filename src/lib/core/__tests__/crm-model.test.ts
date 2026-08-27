// Правила воронки живут в двух местах сразу — в сервисе (crm.ts отдаёт 422) и в
// интерфейсе (кнопка гаснет с объяснением). Разойдутся молча: экран покажет
// кнопку, которая отвечает отказом.

import { describe, expect, it } from "vitest";
import {
  buildFunnel,
  daysOnStage,
  fallbackStageId,
  intakeStage,
  isClosedKind,
  PIPELINE_TEMPLATES,
  stageDeleteBlock,
  templateStages,
  visibleStages,
  type StageKind,
  type StageShape,
} from "../crm-model";

function stage(id: string, kind: StageKind, position: number, archived = false): StageShape {
  return { id, kind, position, archived_at: archived ? "2026-08-01T00:00:00Z" : null };
}

const PIPELINE: StageShape[] = [
  stage("intake", "open", 1),
  stage("qual", "open", 2),
  stage("won", "won", 3),
  stage("lost", "lost", 4),
];

describe("шаблоны воронки", () => {
  it("каждый шаблон рождает воронку с итогами — без них не считается конверсия", () => {
    for (const key of Object.keys(PIPELINE_TEMPLATES)) {
      const stages = templateStages(key);
      expect(stages.filter((s) => s.kind === "won")).toHaveLength(1);
      expect(stages.filter((s) => s.kind === "lost")).toHaveLength(1);
      expect(stages.filter((s) => s.kind === "open").length).toBeGreaterThan(0);
    }
  });

  it("неизвестный шаблон не даёт пустую воронку, а падает на «Продажи»", () => {
    expect(templateStages("нет-такого")).toEqual(PIPELINE_TEMPLATES.sales.stages);
  });
});

describe("удаление этапа", () => {
  it("итоговые этапы удалить нельзя", () => {
    expect(stageDeleteBlock(PIPELINE, "won")).toBe("terminal");
    expect(stageDeleteBlock(PIPELINE, "lost")).toBe("terminal");
  });

  it("рабочий этап удаляется, пока остаётся хотя бы один другой", () => {
    expect(stageDeleteBlock(PIPELINE, "qual")).toBeNull();
  });

  it("последний рабочий этап удалить нельзя — сделке некуда падать", () => {
    const single = [stage("only", "open", 1), stage("won", "won", 2), stage("lost", "lost", 3)];
    expect(stageDeleteBlock(single, "only")).toBe("last_open");
  });

  it("архивный этап не считается за оставшийся рабочий", () => {
    const withArchived = [
      stage("only", "open", 1),
      stage("old", "open", 2, true),
      stage("won", "won", 3),
      stage("lost", "lost", 4),
    ];
    expect(stageDeleteBlock(withArchived, "only")).toBe("last_open");
  });

  it("сделки удаляемого этапа переезжают на соседний рабочий, а не в итог", () => {
    expect(fallbackStageId(PIPELINE, "qual")).toBe("intake");
    expect(fallbackStageId(PIPELINE, "intake")).toBe("qual");
  });
});

describe("этап приёма", () => {
  it("новая сделка встаёт в первый рабочий этап по позиции", () => {
    expect(intakeStage(PIPELINE)?.id).toBe("intake");
  });

  it("архивный первый этап не принимает сделки", () => {
    const stages = [stage("old", "open", 1, true), stage("qual", "open", 2), stage("won", "won", 3)];
    expect(intakeStage(stages)?.id).toBe("qual");
  });

  it("порядок этапов идёт по позиции, а не по порядку в массиве", () => {
    const shuffled = [stage("b", "open", 2), stage("a", "open", 1)];
    expect(visibleStages(shuffled, null).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("закрытость выводится из вида этапа", () => {
  it("итоговые виды закрывают сделку, рабочий — нет", () => {
    expect(isClosedKind("won")).toBe(true);
    expect(isClosedKind("lost")).toBe(true);
    expect(isClosedKind("open")).toBe(false);
  });
});

describe("воронка конверсий", () => {
  const stages = [
    { id: "intake", name: "Неразобранное", kind: "open" as StageKind, position: 1 },
    { id: "qual", name: "Квалификация", kind: "open" as StageKind, position: 2 },
    { id: "won", name: "Выиграно", kind: "won" as StageKind, position: 3 },
    { id: "lost", name: "Проиграно", kind: "lost" as StageKind, position: 4 },
  ];

  it("считает доли от первого этапа и конверсию из предыдущего", () => {
    const funnel = buildFunnel(stages, new Map([["intake", 100], ["qual", 50], ["won", 20]]));
    expect(funnel.map((s) => [s.stage_id, s.share, s.conversion])).toEqual([
      ["intake", 100, 100],
      ["qual", 50, 50],
      ["won", 20, 40],
    ]);
  });

  it("проигрыш не входит в воронку — это выход вбок, а не шаг к успеху", () => {
    const funnel = buildFunnel(stages, new Map([["intake", 10], ["lost", 7]]));
    expect(funnel.some((s) => s.stage_id === "lost")).toBe(false);
  });

  it("пустой период не делит на ноль, а честно говорит «не определено»", () => {
    const funnel = buildFunnel(stages, new Map());
    expect(funnel.every((s) => s.share === 0)).toBe(true);
    expect(funnel[1].conversion).toBeNull();
  });

  it("пропущенный этап не превращает следующий в «0%», хотя сделки там есть", () => {
    // Сделка прошла Неразобранное → Выиграно мимо квалификации: конверсия в
    // выигрыш из пустого этапа не определена, а не равна нулю.
    const funnel = buildFunnel(stages, new Map([["intake", 1], ["won", 1]]));
    expect(funnel.find((s) => s.stage_id === "qual")?.entered).toBe(0);
    expect(funnel.find((s) => s.stage_id === "won")?.conversion).toBeNull();
    expect(funnel.find((s) => s.stage_id === "won")?.share).toBe(100);
  });
});

describe("возраст на этапе", () => {
  it("считает полные сутки и не уходит в минус на будущей дате", () => {
    const now = new Date("2026-08-10T12:00:00Z");
    expect(daysOnStage("2026-08-10T09:00:00Z", now)).toBe(0);
    expect(daysOnStage("2026-08-07T12:00:00Z", now)).toBe(3);
    expect(daysOnStage("2026-08-20T12:00:00Z", now)).toBe(0);
  });
});
