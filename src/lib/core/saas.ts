// SaaS-обвязка: лимиты плана, вебхуки, аудит-лента и экспорт данных организации.

import { createHmac, randomBytes } from "node:crypto";
import { prepare } from "@/lib/sql";
import { DomainError } from "./http";
import { assertOrg, canOrg, effectiveProjectRole } from "./policy";
import type { AuthContext, CoreEvent, PolicyProject } from "./types";

// --- Лимиты плана ------------------------------------------------------------------

export type Plan = "free" | "team" | "business";

export interface Limits {
  members: number;
  projects: number;
  guests: number;
  webhooks: number;
}

// Лимиты подобраны так, чтобы ни одна функция продукта не оказалась полностью
// недоступной на бесплатном плане: иначе фича существует только в коде.
const PLAN_LIMITS: Record<Plan, Limits> = {
  free: { members: 10, projects: 20, guests: 3, webhooks: 1 },
  team: { members: 50, projects: 200, guests: 25, webhooks: 5 },
  business: { members: 500, projects: 2000, guests: 250, webhooks: 50 },
};

export interface OrgUsage {
  plan: Plan;
  limits: Limits;
  usage: { members: number; projects: number; guests: number; webhooks: number };
}

export async function getOrgUsage(ctx: AuthContext): Promise<OrgUsage> {
  // Тариф, лимиты и численность организации — внутренняя информация.
  assertOrg(ctx, "clients.view");
  const row = await prepare<{ plan: Plan; entitlements: Partial<Limits> }>(
    `SELECT plan, entitlements FROM core.organizations WHERE id = ?`,
  ).get(ctx.orgId);
  const plan = row?.plan ?? "free";
  // entitlements — точечные надбавки поверх плана (ручные, для отдельных клиентов).
  const limits = { ...PLAN_LIMITS[plan], ...(row?.entitlements ?? {}) };

  const usage = await prepare<{ members: number; guests: number; projects: number; webhooks: number }>(
    `SELECT
       (SELECT count(*)::int FROM core.org_members WHERE org_id = ?) AS members,
       (SELECT count(*)::int FROM core.org_members WHERE org_id = ? AND role = 'guest') AS guests,
       (SELECT count(*)::int FROM core.projects WHERE org_id = ? AND archived_at IS NULL) AS projects,
       (SELECT count(*)::int FROM core.webhooks WHERE org_id = ?) AS webhooks`,
  ).get(ctx.orgId, ctx.orgId, ctx.orgId, ctx.orgId);

  return {
    plan,
    limits,
    usage: usage ?? { members: 0, projects: 0, guests: 0, webhooks: 0 },
  };
}

const LIMIT_MESSAGES: Record<keyof Limits, string> = {
  members: "Достигнут лимит участников для текущего плана",
  projects: "Достигнут лимит проектов для текущего плана",
  guests: "Достигнут лимит гостевых участников для текущего плана",
  webhooks: "Достигнут лимит вебхуков для текущего плана",
};

/** Бросает 402, если добавление ещё одной единицы вышло бы за лимит плана. */
export async function assertWithinLimit(ctx: AuthContext, key: keyof Limits): Promise<void> {
  const { limits, usage } = await getOrgUsage(ctx);
  if (usage[key] >= limits[key]) {
    throw new DomainError(402, LIMIT_MESSAGES[key]);
  }
}

// --- Аудит-лента организации ---------------------------------------------------------

/**
 * Журнал действий организации: кто и что делал. Для сущностей, которых админ
 * не видит (приватные проекты), payload скрывается — остаются факт действия,
 * автор и время. Аудит отвечает на вопрос «кто менял», а не «что именно».
 */
export async function listOrgAudit(
  ctx: AuthContext,
  opts: { limit?: number; before?: number } = {},
): Promise<CoreEvent[]> {
  assertOrg(ctx, "audit.view");
  const rows = await prepare<
    CoreEvent & { actor_email: string | null; actor_name: string | null; actor_avatar: string | null }
  >(
    `SELECT e.id, e.org_id, e.actor_id, e.entity_type, e.entity_id, e.verb, e.payload, e.created_at,
            u.email AS actor_email, u.name AS actor_name, u.avatar_url AS actor_avatar
     FROM core.events e
     LEFT JOIN core.users u ON u.id = e.actor_id
     WHERE e.org_id = ? AND (?::bigint IS NULL OR e.id < ?::bigint)
     ORDER BY e.id DESC
     LIMIT ?`,
  ).all(ctx.orgId, opts.before ?? null, opts.before ?? null, Math.min(opts.limit ?? 100, 500));

  const projectIds = [
    ...new Set([
      ...rows.filter((r) => r.entity_type === "project").map((r) => r.entity_id),
      ...rows
        .map((r) => (r.payload as { project_id?: string } | null)?.project_id)
        .filter((id): id is string => !!id),
    ]),
  ];
  const visibleProjects = new Set<string>();
  if (projectIds.length > 0) {
    const ph = projectIds.map(() => "?").join(",");
    const projects = await prepare<PolicyProject>(
      `SELECT id, org_id, visibility FROM core.projects WHERE id IN (${ph})`,
    ).all(projectIds);
    for (const p of projects) {
      if (effectiveProjectRole(ctx, p) !== null) visibleProjects.add(p.id);
    }
  }

  // Задачи приватных проектов: заголовок в payload не показываем.
  const taskIds = rows.filter((r) => r.entity_type === "task").map((r) => r.entity_id);
  const visibleTasks = new Set<string>();
  if (taskIds.length > 0) {
    const ph = taskIds.map(() => "?").join(",");
    const rowsWithProjects = await prepare<{ task_id: string; project_id: string | null; created_by: string | null }>(
      `SELECT t.id AS task_id, tp.project_id, t.created_by
       FROM core.tasks t LEFT JOIN core.task_projects tp ON tp.task_id = t.id
       WHERE t.id IN (${ph})`,
    ).all(taskIds);
    const projectsOfTasks = [...new Set(rowsWithProjects.map((r) => r.project_id).filter((id): id is string => !!id))];
    if (projectsOfTasks.length > 0) {
      const ph2 = projectsOfTasks.map(() => "?").join(",");
      const projects = await prepare<PolicyProject>(
        `SELECT id, org_id, visibility FROM core.projects WHERE id IN (${ph2})`,
      ).all(projectsOfTasks);
      for (const p of projects) {
        if (effectiveProjectRole(ctx, p) !== null) visibleProjects.add(p.id);
      }
    }
    for (const r of rowsWithProjects) {
      if (r.created_by === ctx.user.id || (r.project_id && visibleProjects.has(r.project_id))) {
        visibleTasks.add(r.task_id);
      }
    }
  }

  return rows.map((r) => {
    const visible =
      r.entity_type === "task"
        ? visibleTasks.has(r.entity_id)
        : r.entity_type === "project"
          ? visibleProjects.has(r.entity_id)
          : true;
    return {
      id: Number(r.id),
      org_id: r.org_id,
      actor_id: r.actor_id,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      verb: r.verb,
      payload: visible ? r.payload : {},
      created_at: r.created_at,
      actor: r.actor_id
        ? { id: r.actor_id, email: r.actor_email ?? "", name: r.actor_name ?? "", avatar_url: r.actor_avatar }
        : null,
    };
  });
}

// --- Вебхуки ---------------------------------------------------------------------------

export interface Webhook {
  id: string;
  org_id: string;
  url: string;
  events: string[];
  enabled: boolean;
  last_error: string | null;
  last_sent_at: string | null;
  created_at: string;
}

export async function listWebhooks(ctx: AuthContext): Promise<Webhook[]> {
  assertOrg(ctx, "org.update");
  return prepare<Webhook>(
    `SELECT id, org_id, url, events, enabled, last_error, last_sent_at, created_at
     FROM core.webhooks WHERE org_id = ? ORDER BY created_at DESC`,
  ).all(ctx.orgId);
}

export async function createWebhook(
  ctx: AuthContext,
  input: { url: string; events: string[] },
): Promise<Webhook & { secret: string }> {
  assertOrg(ctx, "org.update");
  if (!isPublicHttpsUrl(input.url)) {
    throw new DomainError(422, "Нужен публичный https-адрес");
  }
  await assertWithinLimit(ctx, "webhooks");
  // Секрет показывается один раз — им подписывается тело запроса (HMAC-SHA256).
  const secret = randomBytes(24).toString("base64url");
  const row = await prepare<Webhook>(
    `INSERT INTO core.webhooks (org_id, url, secret, events, created_by)
     VALUES (?, ?, ?, ?::jsonb, ?)
     RETURNING id, org_id, url, events, enabled, last_error, last_sent_at, created_at`,
  ).get(ctx.orgId, input.url, secret, JSON.stringify(input.events), ctx.user.id);
  if (!row) throw new DomainError(500, "Failed to create webhook");
  return { ...row, secret };
}

export async function deleteWebhook(ctx: AuthContext, webhookId: string): Promise<void> {
  assertOrg(ctx, "org.update");
  const changed = await prepare(
    `DELETE FROM core.webhooks WHERE id = ? AND org_id = ?`,
  ).run(webhookId, ctx.orgId);
  if (changed.changes === 0) throw new DomainError(404, "Webhook not found");
}

export function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

const PRIVATE_IPV4_RE =
  /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * Вебхук указывает произвольный адрес, поэтому доставка не должна становиться
 * дверью во внутреннюю сеть (метаданные облака, локальные сервисы).
 */
export function isPublicHttpsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  // IPv6 в URL приходит в скобках; ::1 и fc00::/7 (unique local) — не публичные.
  if (host.startsWith("[")) {
    const ip = host.slice(1, -1);
    return !(ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80"));
  }
  // Сравниваем именно домены целиком: localhost.example.com — публичный адрес.
  const labels = host.split(".");
  const tld = labels[labels.length - 1];
  if (host === "localhost" || tld === "localhost" || tld === "local" || tld === "internal") return false;

  return !PRIVATE_IPV4_RE.test(host);
}

interface DeliveryRow {
  id: string;
  webhook_id: string;
  attempts: number;
  url: string;
  secret: string;
  event_id: number;
  org_id: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  verb: string;
  payload: Record<string, unknown>;
  created_at: string;
}

const MAX_ATTEMPTS = 5;

/** Одна пачка доставок. Вызывается из /api/v2/cron. */
export async function deliverWebhooks(limit = 20): Promise<{ sent: number; failed: number }> {
  const due = await prepare<DeliveryRow>(
    `SELECT d.id, d.webhook_id, d.attempts, w.url, w.secret,
            e.id AS event_id, e.org_id, e.actor_id, e.entity_type, e.entity_id::text AS entity_id,
            e.verb, e.payload, e.created_at
     FROM core.webhook_deliveries d
     JOIN core.webhooks w ON w.id = d.webhook_id AND w.enabled
     JOIN core.events e ON e.id = d.event_id
     WHERE d.status = 'pending' AND d.next_retry_at <= now()
     ORDER BY d.next_retry_at
     LIMIT ?`,
  ).all(limit);

  let sent = 0;
  let failed = 0;

  for (const d of due) {
    const body = JSON.stringify({
      id: Number(d.event_id),
      org_id: d.org_id,
      verb: d.verb,
      entity: { type: d.entity_type, id: d.entity_id },
      actor_id: d.actor_id,
      payload: d.payload,
      created_at: d.created_at,
    });
    try {
      if (!isPublicHttpsUrl(d.url)) throw new Error("Адрес недоступен для доставки");
      const res = await fetch(d.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-SecondBrain-Signature": signPayload(d.secret, body),
          "X-SecondBrain-Event": d.verb,
        },
        body,
        // Редирект мог бы увести запрос на внутренний адрес в обход проверки.
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error("Эндпоинт не принял событие");
      await prepare(
        `UPDATE core.webhook_deliveries SET status = 'sent', attempts = attempts + 1 WHERE id = ?`,
      ).run(d.id);
      await prepare(`UPDATE core.webhooks SET last_sent_at = now(), last_error = NULL WHERE id = ?`).run(d.webhook_id);
      sent++;
    } catch (err) {
      const attempts = d.attempts + 1;
      // Детали ответа наружу не показываем: иначе last_error превращается
      // в сканер внутренней сети.
      const message =
        err instanceof Error && err.name === "TimeoutError"
          ? "Эндпоинт не ответил вовремя"
          : err instanceof Error && err.message.startsWith("Эндпоинт")
            ? err.message
            : err instanceof Error && err.message.startsWith("Адрес")
              ? err.message
              : "Ошибка доставки";
      // Экспоненциальная пауза: 1, 2, 4, 8 минут — потом сдаёмся.
      await prepare(
        `UPDATE core.webhook_deliveries
         SET attempts = ?, last_error = ?,
             status = CASE WHEN ? >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
             next_retry_at = now() + (interval '1 minute' * power(2, ?))
         WHERE id = ?`,
      ).run(attempts, message, attempts, Math.min(attempts, 4), d.id);
      await prepare(`UPDATE core.webhooks SET last_error = ? WHERE id = ?`).run(message, d.webhook_id);
      failed++;
    }
  }
  return { sent, failed };
}

// --- Экспорт данных организации ----------------------------------------------------------

/**
 * Выгрузка организации. Содержимое приватных проектов, куда выгружающий не
 * входит, не включается: экспорт не должен быть обходным путём к чужому
 * приватному контуру (сами проекты перечисляются, но без задач и комментариев).
 */
export async function exportOrg(ctx: AuthContext): Promise<Record<string, unknown>> {
  assertOrg(ctx, "org.update");

  const allProjects = await prepare<
    PolicyProject & { name: string; description: string; archived_at: string | null; created_at: string }
  >(
    `SELECT id, org_id, visibility, name, description, archived_at, created_at
     FROM core.projects WHERE org_id = ?`,
  ).all(ctx.orgId);
  const visibleProjectIds = allProjects
    .filter((p) => effectiveProjectRole(ctx, p) !== null)
    .map((p) => p.id);

  // Задача попадает в выгрузку, если она лежит хотя бы в одном видимом проекте
  // или создана самим выгружающим (личный инбокс).
  const projectFilter = visibleProjectIds.length > 0 ? visibleProjectIds.map(() => "?").join(",") : "NULL";
  const taskParams: unknown[] =
    visibleProjectIds.length > 0 ? [ctx.orgId, visibleProjectIds, ctx.user.id] : [ctx.orgId, ctx.user.id];
  const taskScope = `
    t.org_id = ?
    AND (
      ${visibleProjectIds.length > 0
        ? `EXISTS (SELECT 1 FROM core.task_projects tp WHERE tp.task_id = t.id AND tp.project_id IN (${projectFilter})) OR`
        : ""}
      t.created_by = ?
    )`;

  const [org, members, tasks, placements, comments, clients] = await Promise.all([
    prepare(`SELECT id, name, slug, plan, created_at FROM core.organizations WHERE id = ?`).get(ctx.orgId),
    prepare(
      `SELECT u.email, u.name, m.role, m.created_at
       FROM core.org_members m JOIN core.users u ON u.id = m.user_id WHERE m.org_id = ?`,
    ).all(ctx.orgId),
    prepare(
      `SELECT t.id, t.title, t.description, t.priority, t.due_date, t.due_time, t.completed_at,
              t.parent_task_id, t.created_at, s.name AS status
       FROM core.tasks t LEFT JOIN core.task_statuses s ON s.id = t.status_id
       WHERE ${taskScope}`,
    ).all(...taskParams),
    prepare(
      `SELECT tp.task_id, tp.project_id FROM core.task_projects tp
       JOIN core.tasks t ON t.id = tp.task_id
       WHERE ${taskScope}`,
    ).all(...taskParams),
    prepare(
      `SELECT c.entity_type, c.entity_id, c.body, c.created_at, u.email AS author
       FROM core.comments c
       LEFT JOIN core.users u ON u.id = c.author_id
       JOIN core.tasks t ON t.id = c.entity_id AND c.entity_type = 'task'
       WHERE c.org_id = ? AND c.deleted_at IS NULL AND ${taskScope}`,
    ).all(ctx.orgId, ...taskParams),
    canOrg(ctx, "clients.view")
      ? prepare(`SELECT id, name, budget, monthly_revenue, created_at FROM core.clients WHERE org_id = ?`).all(ctx.orgId)
      : Promise.resolve([]),
  ]);

  return {
    exported_at: new Date().toISOString(),
    organization: org,
    members,
    projects: allProjects.map((p) => ({
      id: p.id,
      name: p.name,
      description: visibleProjectIds.includes(p.id) ? p.description : null,
      visibility: p.visibility,
      archived_at: p.archived_at,
      created_at: p.created_at,
      exported_content: visibleProjectIds.includes(p.id),
    })),
    tasks,
    task_projects: placements,
    comments,
    clients,
  };
}
