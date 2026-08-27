// Правила воронок продаж: шаблоны этапов, что можно удалить, как считается
// воронка конверсий.
//
// Чистые функции без SQL — их зовёт и сервер (crm.ts), и интерфейс. Тот же
// приём, что у status-model.ts: источник истины здесь сервер, а интерфейс
// повторяет правило, чтобы не рисовать кнопку, которая ответит 422.

export type StageKind = "open" | "won" | "lost";

export interface StageShape {
  id: string;
  kind: StageKind;
  position: number;
  archived_at: string | null;
}

/** Порядок видов на доске: рабочие этапы, потом итоги. */
export const STAGE_KIND_LABELS: Record<StageKind, string> = {
  open: "в работе",
  won: "выиграно",
  lost: "проиграно",
};

/**
 * Шаблон новой воронки. Пустой воронки не бывает: заявке некуда падать, а без
 * итоговых этапов не считается ни одна конверсия — ровно то же правило, что у
 * набора статусов (см. 16г в CLAUDE.md ядра).
 */
export interface StageTemplate {
  name: string;
  color: string;
  kind: StageKind;
  probability: number;
}

const WON_LOST: StageTemplate[] = [
  { name: "Выиграно", color: "#10b981", kind: "won", probability: 100 },
  { name: "Проиграно", color: "#dc2626", kind: "lost", probability: 0 },
];

export const PIPELINE_TEMPLATES: Record<string, { title: string; stages: StageTemplate[] }> = {
  sales: {
    title: "Продажи",
    stages: [
      { name: "Неразобранное", color: "#94a3b8", kind: "open", probability: 0 },
      { name: "Квалификация", color: "#3b82f6", kind: "open", probability: 20 },
      { name: "Переговоры", color: "#8b5cf6", kind: "open", probability: 50 },
      { name: "Оплата", color: "#f59e0b", kind: "open", probability: 80 },
      ...WON_LOST,
    ],
  },
  minimal: {
    title: "Минимальная",
    stages: [
      { name: "Неразобранное", color: "#94a3b8", kind: "open", probability: 0 },
      ...WON_LOST,
    ],
  },
};

export type PipelineTemplateId = keyof typeof PIPELINE_TEMPLATES;

export function templateStages(id: string): StageTemplate[] {
  return (PIPELINE_TEMPLATES[id] ?? PIPELINE_TEMPLATES.sales).stages;
}

/**
 * Почему этап нельзя удалить; null — можно.
 *
 * Итоговые этапы есть в каждой воронке: без «Выиграно» сделку нечем закрыть, а
 * без «Проиграно» отказ пришлось бы изображать удалением сделки — и он выпал бы
 * из аналитики. Рабочий этап удалить можно всегда: сделки переезжают на соседа.
 */
export type StageDeleteBlock = "terminal" | "last_open" | null;

export function stageDeleteBlock(stages: StageShape[], stageId: string): StageDeleteBlock {
  const target = stages.find((s) => s.id === stageId);
  if (!target) return null;
  if (target.kind !== "open") return "terminal";
  const openLeft = stages.filter((s) => s.kind === "open" && !s.archived_at && s.id !== stageId);
  return openLeft.length === 0 ? "last_open" : null;
}

export function stageDeleteMessage(block: Exclude<StageDeleteBlock, null>): string {
  return block === "terminal"
    ? "Итоговые этапы «Выиграно» и «Проиграно» есть в каждой воронке — их нельзя удалить"
    : "В воронке должен остаться хотя бы один рабочий этап";
}

/**
 * Куда переедут сделки удаляемого этапа: соседний рабочий этап той же воронки.
 * Возвращает null, если ехать некуда — удаление в этом случае и запрещено.
 */
export function fallbackStageId(stages: StageShape[], stageId: string): string | null {
  const rest = stages
    .filter((s) => s.id !== stageId && s.kind === "open" && !s.archived_at)
    .sort((a, b) => a.position - b.position);
  return rest[0]?.id ?? null;
}

/** Этап, в который встаёт новая сделка: первый рабочий по позиции. */
export function intakeStage<T extends StageShape>(stages: T[]): T | undefined {
  return stages
    .filter((s) => s.kind === "open" && !s.archived_at)
    .sort((a, b) => a.position - b.position)[0];
}

/** Живые этапы воронки по порядку. Архивные не рисуются, но живут в отчётах. */
export function visibleStages<T extends StageShape>(stages: T[], pipelineId: string | null): T[] {
  return stages
    .filter((s) => !s.archived_at && (!pipelineId || (s as { pipeline_id?: string }).pipeline_id === pipelineId))
    .sort((a, b) => a.position - b.position);
}

/**
 * Сделка закрыта, если её этап — итоговый. Признак выводится из вида этапа, а не
 * хранится: две колонки на одно и то же разъезжаются.
 */
export function isClosedKind(kind: StageKind): boolean {
  return kind === "won" || kind === "lost";
}

// --- Воронка конверсий -------------------------------------------------------

export interface FunnelStep {
  stage_id: string;
  name: string;
  kind: StageKind;
  /** Сколько сделок ВХОДИЛО в этап за период (из истории, а не снимок доски). */
  entered: number;
  /** Доля от первого этапа, %. */
  share: number;
  /**
   * Конверсия из предыдущего этапа, %. `null` — предыдущий этап пуст, и
   * конверсия не определена: сделки в воронке пропускают этапы, и «0%» на
   * этапе, где сделки есть, читалось бы как провал вместо «не через этот шаг».
   */
  conversion: number | null;
}

/**
 * Воронка считается по истории входов, а не по тому, где сделки лежат сейчас:
 * снимок доски отвечает на вопрос «где они», а воронка — «сколько дошло».
 * Сделка, проехавшая этап насквозь за час, в снимке не видна вовсе.
 */
export function buildFunnel(
  stages: Array<{ id: string; name: string; kind: StageKind; position: number }>,
  enteredByStage: ReadonlyMap<string, number>,
): FunnelStep[] {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  // «Проиграно» в воронку не входит: это выход вбок, и в столбце конверсий он
  // читался бы как ещё один шаг к успеху.
  const flow = ordered.filter((s) => s.kind !== "lost");
  const first = enteredByStage.get(flow[0]?.id ?? "") ?? 0;
  let prev = 0;
  return flow.map((stage, i) => {
    const entered = enteredByStage.get(stage.id) ?? 0;
    const step: FunnelStep = {
      stage_id: stage.id,
      name: stage.name,
      kind: stage.kind,
      entered,
      share: first > 0 ? Math.round((entered / first) * 100) : 0,
      conversion: i === 0 ? 100 : prev > 0 ? Math.round((entered / prev) * 100) : null,
    };
    prev = entered;
    return step;
  });
}

/**
 * Сколько дней сделка стоит на текущем этапе. Порог подсветки — не правило
 * домена, а привычка: доска красит метку жёлтым, чтобы застой был виден без
 * отчёта.
 */
export const STUCK_DAYS = 7;

export function daysOnStage(enteredAt: string, now: Date): number {
  const ms = now.getTime() - new Date(enteredAt).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
