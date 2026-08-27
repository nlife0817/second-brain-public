// CRM-клиенты: карточка со вложенными коллекциями (компании, контакты с полями,
// заметки, ссылки, CRM-системы). Гостям раздел недоступен целиком.

import { prepare, transaction } from "@/lib/sql";
import { emitEvent } from "./events";
import { DomainError } from "./http";
import { assertOrg } from "./policy";
import type { AuthContext } from "./types";

export interface ClientStatus {
  id: string;
  org_id: string;
  name: string;
  color: string;
  position: number;
}

export interface CrmSystem {
  id: string;
  org_id: string;
  name: string;
  position: number;
}

export interface Client {
  id: string;
  org_id: string;
  name: string;
  status_id: string | null;
  budget: string;
  operators_per_shift: string;
  operators_total: string;
  calls_per_month: string;
  monthly_revenue: number | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ClientContactField {
  id: string;
  contact_id: string;
  type: "email" | "phone" | "telegram" | "note";
  value: string;
}

export interface ClientContact {
  id: string;
  client_id: string;
  name: string;
  position: number;
  fields: ClientContactField[];
}

export interface ClientFull extends Client {
  companies: { id: string; name: string }[];
  contacts: ClientContact[];
  notes: { id: string; text: string; created_at: string; author_name: string | null }[];
  links: { id: string; url: string; title: string }[];
  crm_system_ids: string[];
}

export interface ClientInput {
  name: string;
  status_id?: string | null;
  budget?: string;
  operators_per_shift?: string;
  operators_total?: string;
  calls_per_month?: string;
  monthly_revenue?: number | null;
  crm_system_ids?: string[];
  companies?: { name: string }[];
  contacts?: { name: string; fields?: { type: ClientContactField["type"]; value: string }[] }[];
  links?: { url: string; title: string }[];
}

// --- Справочники ------------------------------------------------------------------

export async function listClientStatuses(ctx: AuthContext): Promise<ClientStatus[]> {
  assertOrg(ctx, "crm.view");
  return prepare<ClientStatus>(
    `SELECT id, org_id, name, color, position FROM core.client_statuses
     WHERE org_id = ? ORDER BY position, name`,
  ).all(ctx.orgId);
}

export async function createClientStatus(
  ctx: AuthContext,
  input: { name: string; color?: string },
): Promise<ClientStatus> {
  assertOrg(ctx, "crm.manage");
  const row = await prepare<ClientStatus>(
    `INSERT INTO core.client_statuses (org_id, name, color, position)
     VALUES (?, ?, ?, COALESCE((SELECT max(position) + 1 FROM core.client_statuses WHERE org_id = ?), 1))
     RETURNING id, org_id, name, color, position`,
  ).get(ctx.orgId, input.name, input.color ?? "#6b7280", ctx.orgId);
  if (!row) throw new DomainError(500, "Failed to create status");
  return row;
}

export async function deleteClientStatus(ctx: AuthContext, statusId: string): Promise<void> {
  assertOrg(ctx, "crm.manage");
  const changed = await prepare(
    `DELETE FROM core.client_statuses WHERE id = ? AND org_id = ?`,
  ).run(statusId, ctx.orgId);
  if (changed.changes === 0) throw new DomainError(404, "Status not found");
}

export async function listCrmSystems(ctx: AuthContext): Promise<CrmSystem[]> {
  assertOrg(ctx, "crm.view");
  return prepare<CrmSystem>(
    `SELECT id, org_id, name, position FROM core.crm_systems WHERE org_id = ? ORDER BY position, name`,
  ).all(ctx.orgId);
}

export async function createCrmSystem(ctx: AuthContext, name: string): Promise<CrmSystem> {
  assertOrg(ctx, "crm.manage");
  const row = await prepare<CrmSystem>(
    `INSERT INTO core.crm_systems (org_id, name, position)
     VALUES (?, ?, COALESCE((SELECT max(position) + 1 FROM core.crm_systems WHERE org_id = ?), 1))
     ON CONFLICT (org_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, org_id, name, position`,
  ).get(ctx.orgId, name, ctx.orgId);
  if (!row) throw new DomainError(500, "Failed to create CRM system");
  return row;
}

// --- Клиенты ------------------------------------------------------------------------

export async function listClients(ctx: AuthContext): Promise<Client[]> {
  assertOrg(ctx, "crm.view");
  return prepare<Client>(
    `SELECT id, org_id, name, status_id, budget, operators_per_shift, operators_total,
            calls_per_month, monthly_revenue, position, created_at, updated_at
     FROM core.clients WHERE org_id = ? ORDER BY position, name`,
  ).all(ctx.orgId);
}

export async function getClient(ctx: AuthContext, clientId: string): Promise<ClientFull> {
  assertOrg(ctx, "crm.view");
  const client = await prepare<Client>(
    `SELECT id, org_id, name, status_id, budget, operators_per_shift, operators_total,
            calls_per_month, monthly_revenue, position, created_at, updated_at
     FROM core.clients WHERE id = ? AND org_id = ?`,
  ).get(clientId, ctx.orgId);
  if (!client) throw new DomainError(404, "Client not found");

  const [companies, contacts, fields, notes, links, crm] = await Promise.all([
    prepare<{ id: string; name: string }>(
      `SELECT id, name FROM core.client_companies WHERE client_id = ? ORDER BY name`,
    ).all(clientId),
    prepare<{ id: string; client_id: string; name: string; position: number }>(
      `SELECT id, client_id, name, position FROM core.client_contacts WHERE client_id = ? ORDER BY position`,
    ).all(clientId),
    prepare<ClientContactField>(
      `SELECT f.id, f.contact_id, f.type, f.value
       FROM core.client_contact_fields f
       JOIN core.client_contacts c ON c.id = f.contact_id
       WHERE c.client_id = ?`,
    ).all(clientId),
    prepare<{ id: string; text: string; created_at: string; author_name: string | null }>(
      `SELECT n.id, n.text, n.created_at, u.name AS author_name
       FROM core.client_notes n LEFT JOIN core.users u ON u.id = n.author_id
       WHERE n.client_id = ? ORDER BY n.created_at DESC`,
    ).all(clientId),
    prepare<{ id: string; url: string; title: string }>(
      `SELECT id, url, title FROM core.client_links WHERE client_id = ?`,
    ).all(clientId),
    prepare<{ crm_system_id: string }>(
      `SELECT crm_system_id FROM core.client_crm_systems WHERE client_id = ?`,
    ).all(clientId),
  ]);

  const fieldsByContact = new Map<string, ClientContactField[]>();
  for (const f of fields) {
    const arr = fieldsByContact.get(f.contact_id) ?? [];
    arr.push(f);
    fieldsByContact.set(f.contact_id, arr);
  }

  return {
    ...client,
    companies,
    contacts: contacts.map((c) => ({ ...c, fields: fieldsByContact.get(c.id) ?? [] })),
    notes,
    links,
    crm_system_ids: crm.map((c) => c.crm_system_id),
  };
}

async function assertOrgStatus(ctx: AuthContext, statusId: string | null | undefined): Promise<void> {
  if (!statusId) return;
  const row = await prepare(
    `SELECT 1 FROM core.client_statuses WHERE id = ? AND org_id = ?`,
  ).get(statusId, ctx.orgId);
  if (!row) throw new DomainError(422, "Unknown client status");
}

async function assertOrgCrmSystems(ctx: AuthContext, ids: string[] | undefined): Promise<void> {
  if (!ids || ids.length === 0) return;
  const ph = ids.map(() => "?").join(",");
  const rows = await prepare<{ id: string }>(
    `SELECT id FROM core.crm_systems WHERE org_id = ? AND id IN (${ph})`,
  ).all(ctx.orgId, ids);
  if (rows.length !== new Set(ids).size) throw new DomainError(422, "Unknown CRM system");
}

export async function createClient(ctx: AuthContext, input: ClientInput): Promise<ClientFull> {
  assertOrg(ctx, "crm.manage");
  await assertOrgStatus(ctx, input.status_id);
  await assertOrgCrmSystems(ctx, input.crm_system_ids);

  const clientId = await transaction(async (tx) => {
    const row = await tx
      .prepare<{ id: string }>(
        `INSERT INTO core.clients
           (org_id, name, status_id, budget, operators_per_shift, operators_total,
            calls_per_month, monthly_revenue, position, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?,
                 COALESCE((SELECT max(position) + 1 FROM core.clients WHERE org_id = ?), 1), ?)
         RETURNING id`,
      )
      .get(
        ctx.orgId,
        input.name.trim(),
        input.status_id ?? null,
        input.budget ?? "",
        input.operators_per_shift ?? "",
        input.operators_total ?? "",
        input.calls_per_month ?? "",
        input.monthly_revenue ?? null,
        ctx.orgId,
        ctx.user.id,
      );
    if (!row) throw new DomainError(500, "Failed to create client");
    await writeCollections(tx, row.id, input);
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "client",
      entityId: row.id,
      verb: "client.created",
      payload: { name: input.name.trim() },
    });
    return row.id;
  });

  return getClient(ctx, clientId);
}

type Tx = Parameters<Parameters<typeof transaction>[0]>[0];

/** Вложенные коллекции переписываются целиком — карточка редактируется как форма. */
async function writeCollections(
  tx: Tx,
  clientId: string,
  input: Pick<ClientInput, "companies" | "contacts" | "links" | "crm_system_ids">,
): Promise<void> {
  if (input.companies) {
    await tx.prepare(`DELETE FROM core.client_companies WHERE client_id = ?`).run(clientId);
    for (const c of input.companies) {
      await tx.prepare(`INSERT INTO core.client_companies (client_id, name) VALUES (?, ?)`).run(clientId, c.name);
    }
  }
  if (input.contacts) {
    await tx.prepare(`DELETE FROM core.client_contacts WHERE client_id = ?`).run(clientId);
    for (let i = 0; i < input.contacts.length; i++) {
      const contact = input.contacts[i];
      const row = await tx
        .prepare<{ id: string }>(
          `INSERT INTO core.client_contacts (client_id, name, position) VALUES (?, ?, ?) RETURNING id`,
        )
        .get(clientId, contact.name, i);
      if (!row) continue;
      for (const f of contact.fields ?? []) {
        await tx
          .prepare(`INSERT INTO core.client_contact_fields (contact_id, type, value) VALUES (?, ?, ?)`)
          .run(row.id, f.type, f.value);
      }
    }
  }
  if (input.links) {
    await tx.prepare(`DELETE FROM core.client_links WHERE client_id = ?`).run(clientId);
    for (const l of input.links) {
      await tx.prepare(`INSERT INTO core.client_links (client_id, url, title) VALUES (?, ?, ?)`).run(clientId, l.url, l.title);
    }
  }
  if (input.crm_system_ids) {
    await tx.prepare(`DELETE FROM core.client_crm_systems WHERE client_id = ?`).run(clientId);
    for (const id of new Set(input.crm_system_ids)) {
      await tx.prepare(`INSERT INTO core.client_crm_systems (client_id, crm_system_id) VALUES (?, ?)`).run(clientId, id);
    }
  }
}

export async function updateClient(
  ctx: AuthContext,
  clientId: string,
  patch: Partial<ClientInput> & { position?: number },
): Promise<ClientFull> {
  assertOrg(ctx, "crm.manage");
  const current = await prepare<Client>(
    `SELECT * FROM core.clients WHERE id = ? AND org_id = ?`,
  ).get(clientId, ctx.orgId);
  if (!current) throw new DomainError(404, "Client not found");
  await assertOrgStatus(ctx, patch.status_id);
  await assertOrgCrmSystems(ctx, patch.crm_system_ids);

  await transaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE core.clients SET name = ?, status_id = ?, budget = ?, operators_per_shift = ?,
                operators_total = ?, calls_per_month = ?, monthly_revenue = ?, position = ?
         WHERE id = ?`,
      )
      .run(
        patch.name?.trim() ?? current.name,
        patch.status_id !== undefined ? patch.status_id : current.status_id,
        patch.budget ?? current.budget,
        patch.operators_per_shift ?? current.operators_per_shift,
        patch.operators_total ?? current.operators_total,
        patch.calls_per_month ?? current.calls_per_month,
        patch.monthly_revenue !== undefined ? patch.monthly_revenue : current.monthly_revenue,
        patch.position ?? current.position,
        clientId,
      );
    await writeCollections(tx, clientId, patch);
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "client",
      entityId: clientId,
      verb: "client.updated",
      payload: { fields: Object.keys(patch) },
    });
  });

  return getClient(ctx, clientId);
}

export async function deleteClient(ctx: AuthContext, clientId: string): Promise<void> {
  assertOrg(ctx, "crm.manage");
  const changed = await prepare(`DELETE FROM core.clients WHERE id = ? AND org_id = ?`).run(clientId, ctx.orgId);
  if (changed.changes === 0) throw new DomainError(404, "Client not found");
}

export async function addClientNote(ctx: AuthContext, clientId: string, text: string): Promise<void> {
  assertOrg(ctx, "crm.manage");
  const client = await prepare(`SELECT 1 FROM core.clients WHERE id = ? AND org_id = ?`).get(clientId, ctx.orgId);
  if (!client) throw new DomainError(404, "Client not found");
  await prepare(
    `INSERT INTO core.client_notes (client_id, author_id, text) VALUES (?, ?, ?)`,
  ).run(clientId, ctx.user.id, text);
}
