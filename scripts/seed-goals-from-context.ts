/**
 * One-shot seed: create the 4-axis yearly goal tree from CONTEXT.md / CONTRACT.md.
 *
 * Idempotent — uses fixed `seed_*` ids and ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/seed-goals-from-context.ts
 *
 * The same SQL has already been applied via Supabase MCP on the first run; this
 * file is kept for reference and re-runs against fresh DBs (e.g. preview branches).
 */

import postgres from "postgres";

const PERIOD_START = "2026-05-03";
const PERIOD_END = "2026-11-03";

interface GoalSeed {
  id: string;
  axis: "income" | "debts" | "project" | "health";
  title: string;
  description: string;
  metrics: MetricSeed[];
}

interface MetricSeed {
  id: string;
  kind: "tasks" | "numeric" | "checklist" | "boolean";
  title: string;
  unit?: string;
  target?: number;
  current?: number;
  start?: number;
  direction?: "up" | "down";
  payload?: object;
}

const GOALS: GoalSeed[] = [
  {
    id: "seed_y_income",
    axis: "income",
    title: "Доход: удержание + переговорная готовность",
    description:
      "База — не подорвать качество текущей работы. Параллельно — подготовить документ переговорной позиции под +30%.",
    metrics: [
      {
        id: "seed_kr_income_salary",
        kind: "numeric",
        title: "Зарплата",
        unit: "₽/мес",
        start: 130000,
        current: 130000,
        target: 160000,
        direction: "up",
      },
      {
        id: "seed_kr_income_doc",
        kind: "boolean",
        title: "Документ переговорной позиции готов",
        payload: { done: false },
      },
    ],
  },
  {
    id: "seed_y_debts",
    axis: "debts",
    title: "Долги: агрессивное прямое гашение",
    description:
      "Закрыть Карту №1 к середине июня. Уменьшить кредит 25% минимум на 100k. Карта №2 к ноябрю.",
    metrics: [
      {
        id: "seed_kr_debts_card1",
        kind: "numeric",
        title: "Кредитка №1",
        unit: "₽",
        start: 150000,
        current: 150000,
        target: 0,
        direction: "down",
      },
      {
        id: "seed_kr_debts_loan25",
        kind: "numeric",
        title: "Кредит 25%",
        unit: "₽",
        start: 200000,
        current: 200000,
        target: 100000,
        direction: "down",
      },
      {
        id: "seed_kr_debts_card2",
        kind: "numeric",
        title: "Кредитка №2",
        unit: "₽",
        start: 150000,
        current: 150000,
        target: 0,
        direction: "down",
      },
      {
        id: "seed_kr_debts_friend",
        kind: "numeric",
        title: "Долг подруге",
        unit: "₽",
        start: 44000,
        current: 44000,
        target: 0,
        direction: "down",
      },
    ],
  },
  {
    id: "seed_y_project",
    axis: "project",
    title: "Проект: доводка до MVP, продаваемого состояния",
    description:
      "Один якорь — разработка. Маркетинг и операционка заморожены. Только после закрытия рабочих задач дня.",
    metrics: [
      {
        id: "seed_kr_project_tasks",
        kind: "tasks",
        title: "Задачи к MVP",
      },
      {
        id: "seed_kr_project_windows",
        kind: "numeric",
        title: "Окна по 30+ мин на проект",
        unit: "окон",
        current: 0,
        target: 50,
        direction: "up",
      },
    ],
  },
  {
    id: "seed_y_health",
    axis: "health",
    title: "Здоровье + анти-выгорание: минимум + плановые паузы",
    description:
      "Сон-якорь, спорт-минимум, плановые паузы каждые 3–4 недели. Цель — пройти 6 месяцев без неуправляемого выгорания.",
    metrics: [
      {
        id: "seed_kr_health_workouts",
        kind: "numeric",
        title: "Тренировки",
        unit: "сессий",
        current: 0,
        target: 24,
        direction: "up",
      },
      {
        id: "seed_kr_health_sleep_streak",
        kind: "numeric",
        title: "Недели сна 7+ ч подряд",
        unit: "нед",
        current: 0,
        target: 4,
        direction: "up",
      },
      {
        id: "seed_kr_health_bedtime",
        kind: "boolean",
        title: "Фиксированный отбой настроен",
        payload: { done: false },
      },
      {
        id: "seed_kr_health_burnout",
        kind: "checklist",
        title: "Плановые паузы (раз в 3–4 нед)",
        payload: {
          items: [
            { title: "Пауза 1 (нед 4)", done: false },
            { title: "Пауза 2 (нед 8)", done: false },
            { title: "Пауза 3 (нед 12)", done: false },
            { title: "Пауза 4 (нед 16)", done: false },
            { title: "Пауза 5 (нед 20)", done: false },
            { title: "Пауза 6 (нед 24)", done: false },
          ],
        },
      },
    ],
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const sql = postgres(url, { ssl: "require" });

  for (let i = 0; i < GOALS.length; i++) {
    const g = GOALS[i];
    await sql`
      INSERT INTO goals (id, parent_id, level, axis, title, description, status, period_start, period_end, position)
      VALUES (${g.id}, NULL, 'year', ${g.axis}, ${g.title}, ${g.description}, 'active', ${PERIOD_START}, ${PERIOD_END}, ${i})
      ON CONFLICT (id) DO NOTHING
    `;
    for (let j = 0; j < g.metrics.length; j++) {
      const m = g.metrics[j];
      await sql`
        INSERT INTO goal_metrics (id, goal_id, kind, title, unit, target_value, current_value, start_value, direction, payload, weight, position)
        VALUES (
          ${m.id}, ${g.id}, ${m.kind}, ${m.title},
          ${m.unit ?? null},
          ${m.target ?? null},
          ${m.current ?? null},
          ${m.start ?? null},
          ${m.direction ?? "up"},
          ${m.payload ? sql.json(m.payload as Record<string, unknown>) : null},
          1, ${j}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }
    console.log(`✓ ${g.title}`);
  }

  await sql.end();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
