// Напоминания о сроках: единственный тип уведомлений, который рождается не из
// чужого действия, а из наступившего времени.
//
// Три правила устройства, без которых это работало бы плохо:
//
// 1. Повод, а не момент. Отметка отправки пишется по ключу повода («задача X со
//    сроком на 30 июля 18:00»), а не по времени запуска. Пропущенный тик ничего
//    не теряет: следующий живой тик отработает тот же повод — и ровно один раз,
//    сколько бы раз ни запускался (уникальность в core.reminder_sent).
// 2. Сначала захват, потом отправка. Слоты занимаются INSERT … ON CONFLICT DO
//    NOTHING RETURNING: уведомление создаётся только для реально захваченных.
//    Два параллельных тика не продублируют напоминание.
// 3. Одно сообщение на серию. За прогон у человека может наступить срок сразу у
//    нескольких задач — это одно уведомление со списком, а не пять отдельных.
//
// Сроки хранятся как date + time без зоны, поэтому «сегодня» и «18:00»
// существуют только в часовом поясе получателя (core.notification_settings).

import { prepare, transaction } from "@/lib/sql";
import { DEFAULT_DELIVERY } from "./notification-settings";
import { isTaskMuted } from "./notification-prefs";
import { plural } from "./plural";

/** За сколько минут до срока предупреждаем о задаче с указанным временем. */
const LEAD_MINUTES = 30;

/**
 * Насколько поздно ещё имеет смысл присылать утреннюю сводку. Сервер лежал до
 * обеда — сводка «на сегодня» в 15:00 уже бесполезна и только раздражает;
 * пропускаем, назавтра будет свой повод.
 */
const DIGEST_CATCHUP_HOURS = 3;

/**
 * Окно, в котором задача считается кандидатом. Двое суток вперёд с запасом
 * покрывают предупреждение о завтрашнем раннем сроке, три недели назад — догон
 * просрочек после долгого простоя.
 */
const LOOKBACK_DAYS = 21;
const LOOKAHEAD_DAYS = 2;

/** Сколько названий задач показываем в сгруппированном уведомлении. */
const TITLES_IN_BODY = 3;

type CandidateRow = {
  task_id: string;
  org_id: string;
  title: string;
  due_date: string;
  due_time: string | null;
  user_id: string;
  timezone: string | null;
  digest_hour: number | null;
  reminders_enabled: boolean | null;
};

export interface ReminderTask {
  taskId: string;
  orgId: string;
  title: string;
  dueDate: string;
  dueTime: string | null;
}

// ---- Чистая часть: когда и о чём напоминать ------------------------------------------------

export interface LocalNow {
  /** Локальная дата получателя, YYYY-MM-DD. */
  date: string;
  /** Минуты от полуночи локального дня. */
  minutes: number;
}

/** Локальные дата и время в произвольной IANA-зоне. */
export function localNow(now: Date, timezone: string): LocalNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  // hourCycle h23 отдаёт «24» вместо «00» на полуночи в части сред.
  const hour = Number(get("hour")) % 24;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
  };
}

/** Разница в целых сутках между двумя датами YYYY-MM-DD (a - b). */
function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Момент срока в минутах относительно полуночи локального «сегодня».
 * У задачи без времени сроком считается конец её дня: до полуночи она ещё
 * «сегодняшняя», а не просроченная.
 */
export function dueOffsetMinutes(task: ReminderTask, today: string): number {
  const days = dayDiff(task.dueDate, today);
  return task.dueTime ? days * 1440 + minutesOfDay(task.dueTime) : days * 1440 + 1440;
}

export type ReminderKind = "due_soon" | "overdue";

/**
 * Какое напоминание уместно по этой задаче прямо сейчас (или null).
 * «Скоро» — только у задач с указанным временем: у задачи «на сегодня» без
 * времени предупреждать не о чем, она и так в утренней сводке.
 */
export function reminderFor(task: ReminderTask, now: LocalNow): ReminderKind | null {
  const due = dueOffsetMinutes(task, now.date);
  if (due <= now.minutes) return "overdue";
  if (!task.dueTime) return null;
  return due - now.minutes <= LEAD_MINUTES ? "due_soon" : null;
}

/** Ключ повода: одна задача с одним сроком напоминает о себе единожды. */
export function reminderSlot(task: ReminderTask, kind: ReminderKind): string {
  return `${task.taskId}@${task.dueDate}T${task.dueTime ?? "eod"}:${kind}`;
}

export function digestSlot(orgId: string, localDate: string): string {
  return `${orgId}:${localDate}`;
}

/** Пора ли слать утреннюю сводку: в свой час либо в пределах догона. */
export function digestDue(now: LocalNow, digestHour: number): boolean {
  const hour = Math.floor(now.minutes / 60);
  return hour >= digestHour && hour < digestHour + DIGEST_CATCHUP_HOURS;
}

/** Текст уведомления: одна задача — по имени, несколько — числом и списком. */
export function reminderText(
  kind: ReminderKind | "digest",
  tasks: ReminderTask[],
  overdueCount = 0,
): { title: string; body: string } {
  const titles = tasks.slice(0, TITLES_IN_BODY).map((t) => `«${t.title}»`).join(", ");
  const rest = tasks.length - Math.min(tasks.length, TITLES_IN_BODY);
  const tail = rest > 0 ? ` и ещё ${rest}` : "";

  if (kind === "digest") {
    const parts: string[] = [];
    if (tasks.length > 0) parts.push(`${plural(tasks.length, "задача", "задачи", "задач")} со сроком сегодня`);
    if (overdueCount > 0) parts.push(`${plural(overdueCount, "просрочена", "просрочены", "просрочено")}`);
    return {
      title: "Задачи на сегодня",
      body: `${parts.join(", ")}${tasks.length > 0 ? `: ${titles}${tail}` : ""}`,
    };
  }
  if (kind === "due_soon") {
    return {
      title: "Скоро срок",
      body:
        tasks.length === 1
          ? `${titles} — через ${LEAD_MINUTES} минут или раньше`
          : `${plural(tasks.length, "задача", "задачи", "задач")} со сроком в ближайший час: ${titles}${tail}`,
    };
  }
  return {
    title: "Срок прошёл",
    body: tasks.length === 1 ? `${titles} просрочена` : `${plural(tasks.length, "задача", "задачи", "задач")} просрочено: ${titles}${tail}`,
  };
}

// ---- Работа с базой -----------------------------------------------------------------------

/**
 * Кандидаты: незавершённые задачи со сроком в окне, вместе с получателями и
 * их настройками.
 *
 * Получатель — исполнитель, а если исполнителя нет — автор задачи. Второе
 * правило не формальность: в рабочей базе больше пятисот открытых задач со
 * сроком и ни одного назначения — «напоминания только исполнителям» означало
 * бы, что не приходит ничего и никому. Подписчики ленты сюда не входят:
 * чужой дедлайн — не повод будить.
 */
async function loadCandidates(): Promise<CandidateRow[]> {
  return prepare<CandidateRow>(
    `SELECT t.id::text AS task_id, t.org_id::text AS org_id, t.title,
            t.due_date::text AS due_date, t.due_time::text AS due_time,
            r.user_id::text AS user_id,
            ns.timezone, ns.digest_hour, ns.reminders_enabled
     FROM core.tasks t
     JOIN LATERAL (
       SELECT a.user_id FROM core.task_assignees a WHERE a.task_id = t.id
       UNION
       SELECT t.created_by
       WHERE t.created_by IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM core.task_assignees a2 WHERE a2.task_id = t.id)
     ) r ON true
     LEFT JOIN core.notification_settings ns ON ns.user_id = r.user_id
     WHERE t.completed_at IS NULL
       AND t.due_date IS NOT NULL
       AND t.due_date BETWEEN (current_date - ?::int * interval '1 day')
                          AND (current_date + ?::int * interval '1 day')`,
  ).all(LOOKBACK_DAYS, LOOKAHEAD_DAYS);
}

/** Выключенные типы напоминаний по каждому получателю. */
async function loadDisabledKinds(userIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (userIds.length === 0) return out;
  const placeholders = userIds.map(() => "?").join(",");
  const rows = await prepare<{ user_id: string; kind: string }>(
    `SELECT user_id::text AS user_id, kind FROM core.notification_prefs
     WHERE inbox = false AND user_id IN (${placeholders})`,
  ).all(userIds);
  for (const row of rows) {
    const set = out.get(row.user_id) ?? new Set<string>();
    set.add(row.kind);
    out.set(row.user_id, set);
  }
  return out;
}

/** Проекты задач и заглушённые проекты получателей — для правила isTaskMuted. */
async function loadMuteData(
  taskIds: string[],
  userIds: string[],
): Promise<{ taskProjects: Map<string, string[]>; muted: Map<string, Set<string>> }> {
  const taskProjects = new Map<string, string[]>();
  const muted = new Map<string, Set<string>>();
  if (taskIds.length === 0 || userIds.length === 0) return { taskProjects, muted };

  const taskPlaceholders = taskIds.map(() => "?").join(",");
  const links = await prepare<{ task_id: string; project_id: string }>(
    `SELECT task_id::text AS task_id, project_id::text AS project_id
     FROM core.task_projects WHERE task_id IN (${taskPlaceholders})`,
  ).all(taskIds);
  for (const link of links) {
    taskProjects.set(link.task_id, [...(taskProjects.get(link.task_id) ?? []), link.project_id]);
  }

  const userPlaceholders = userIds.map(() => "?").join(",");
  const mutes = await prepare<{ user_id: string; project_id: string }>(
    `SELECT user_id::text AS user_id, project_id::text AS project_id
     FROM core.project_mutes WHERE user_id IN (${userPlaceholders})`,
  ).all(userIds);
  for (const mute of mutes) {
    const set = muted.get(mute.user_id) ?? new Set<string>();
    set.add(mute.project_id);
    muted.set(mute.user_id, set);
  }
  return { taskProjects, muted };
}

/**
 * Занимает слоты и создаёт по захваченным одно уведомление — в одной
 * транзакции. Порознь эти шаги дают либо потерянное напоминание (отметка
 * встала, процесс упал до записи), либо дубль; вместе — ни того, ни другого.
 *
 * Возвращает true, если уведомление создано (а не «повод уже отработан»).
 */
async function claimAndNotify(input: {
  orgId: string;
  userId: string;
  kind: ReminderKind | "digest";
  tasks: ReminderTask[];
  slots: string[];
  overdueCount?: number;
  /** Занять поводы, но уведомление не создавать (о них уже сказано иначе). */
  silent?: boolean;
}): Promise<boolean> {
  if (input.slots.length === 0) return false;
  return transaction(async (tx) => {
    const values = input.slots.map(() => "(?, ?, ?)").join(",");
    const params: string[] = [];
    for (const slot of input.slots) params.push(input.userId, input.kind, slot);
    const claimed = await tx
      .prepare<{ slot: string }>(
        `INSERT INTO core.reminder_sent (user_id, kind, slot)
         VALUES ${values}
         ON CONFLICT (user_id, kind, slot) DO NOTHING
         RETURNING slot`,
      )
      .all(params);
    if (claimed.length === 0 || input.silent) return false;

    // Утренняя сводка — один слот на день: её состав не сводится к списку
    // захваченных задач, поэтому берём его как есть.
    const claimedSlots = new Set(claimed.map((r) => r.slot));
    const fresh =
      input.kind === "digest"
        ? input.tasks
        : input.tasks.filter((t) => claimedSlots.has(reminderSlot(t, input.kind as ReminderKind)));
    if (input.kind !== "digest" && fresh.length === 0) return false;

    const { title, body } = reminderText(input.kind, fresh, input.overdueCount ?? 0);
    // Одна задача — уведомление ведёт прямо в неё; несколько — в список,
    // потому что «открыть» можно только что-то одно.
    const single = fresh.length === 1 ? fresh[0] : null;
    await tx
      .prepare(
        `INSERT INTO core.notifications (org_id, user_id, kind, entity_type, entity_id, payload)
         VALUES (?, ?, ?, ?, ?::uuid, ?::jsonb)`,
      )
      .run(
        input.orgId,
        input.userId,
        input.kind,
        single ? "task" : null,
        single ? single.taskId : null,
        JSON.stringify({
          title,
          body,
          task_ids: fresh.map((t) => t.taskId),
          count: fresh.length,
          overdue_count: input.overdueCount ?? 0,
        }),
      );
    return true;
  });
}

export interface ReminderRunResult {
  /** Созданные уведомления (после группировки, а не по задачам). */
  created: number;
  /** Сколько получателей их получили. */
  users: number;
}

/**
 * Один проход напоминаний. Идемпотентен и дёшев вхолостую: без подходящих
 * поводов делает один SELECT.
 */
export async function runDueReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const candidates = await loadCandidates();
  if (candidates.length === 0) return { created: 0, users: 0 };

  const userIds = [...new Set(candidates.map((c) => c.user_id))];
  const taskIds = [...new Set(candidates.map((c) => c.task_id))];
  const [disabled, { taskProjects, muted }] = await Promise.all([
    loadDisabledKinds(userIds),
    loadMuteData(taskIds, userIds),
  ]);

  // Группируем по получателю и организации: инбокс живёт внутри организации,
  // одно уведомление не может ссылаться сразу на две.
  type Bucket = {
    orgId: string;
    userId: string;
    timezone: string;
    digestHour: number;
    remindersEnabled: boolean;
    tasks: ReminderTask[];
  };
  const buckets = new Map<string, Bucket>();
  for (const row of candidates) {
    const projects = taskProjects.get(row.task_id) ?? [];
    if (isTaskMuted(projects, muted.get(row.user_id))) continue;
    const key = `${row.user_id}:${row.org_id}`;
    const bucket = buckets.get(key) ?? {
      orgId: row.org_id,
      userId: row.user_id,
      timezone: row.timezone ?? DEFAULT_DELIVERY.timezone,
      digestHour: row.digest_hour ?? DEFAULT_DELIVERY.digest_hour,
      remindersEnabled: row.reminders_enabled ?? DEFAULT_DELIVERY.reminders_enabled,
      tasks: [],
    };
    bucket.tasks.push({
      taskId: row.task_id,
      orgId: row.org_id,
      title: row.title,
      dueDate: row.due_date,
      dueTime: row.due_time ? row.due_time.slice(0, 5) : null,
    });
    buckets.set(key, bucket);
  }

  let created = 0;
  const reached = new Set<string>();

  for (const bucket of buckets.values()) {
    if (!bucket.remindersEnabled) continue;
    const off = disabled.get(bucket.userId) ?? new Set<string>();
    const local = localNow(now, bucket.timezone);

    // --- утренняя сводка ---
    //
    // Идёт первой: если она уходит прямо сейчас, отдельное «столько-то
    // просрочено» будет вторым сообщением о том же самом. Такое встречается
    // ровно в первое утро после включения напоминаний — и портит первое же
    // впечатление о них.
    let digestSent = false;
    const overdueToday = bucket.tasks.filter(
      (t) => dueOffsetMinutes(t, local.date) <= local.minutes,
    );
    if (!off.has("digest") && digestDue(local, bucket.digestHour)) {
      const dueToday = bucket.tasks.filter((t) => t.dueDate === local.date);
      if (dueToday.length > 0 || overdueToday.length > 0) {
        digestSent = await claimAndNotify({
          orgId: bucket.orgId,
          userId: bucket.userId,
          kind: "digest",
          tasks: dueToday,
          slots: [digestSlot(bucket.orgId, local.date)],
          overdueCount: overdueToday.length,
        });
        if (digestSent) {
          created++;
          reached.add(bucket.userId);
        }
      }
    }

    // --- точечные напоминания, сгруппированные по типу ---
    const byKind = new Map<ReminderKind, ReminderTask[]>();
    for (const task of bucket.tasks) {
      const kind = reminderFor(task, local);
      if (!kind || off.has(kind)) continue;
      byKind.set(kind, [...(byKind.get(kind) ?? []), task]);
    }
    for (const [kind, tasks] of byKind) {
      // Просрочки только что перечислены в сводке: поводы гасим, чтобы они не
      // всплыли следующим тиком, но второе сообщение не шлём.
      const silent = digestSent && kind === "overdue";
      const notified = await claimAndNotify({
        orgId: bucket.orgId,
        userId: bucket.userId,
        kind,
        tasks,
        slots: tasks.map((t) => reminderSlot(t, kind)),
        silent,
      });
      if (!notified) continue;
      created++;
      reached.add(bucket.userId);
    }
  }

  return { created, users: reached.size };
}

/** Отметки старше месяца бессмысленны: их поводы давно вне окна кандидатов. */
export async function purgeOldReminderMarks(): Promise<number> {
  const result = await prepare(
    `DELETE FROM core.reminder_sent WHERE created_at < now() - interval '30 days'`,
  ).run();
  return result.changes;
}
