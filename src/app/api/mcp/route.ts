import { createMcpRouteHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  getAllItems,
  getItemById,
  getItemFull,
  createItem,
  updateItem,
  deleteItem,
  getAllClientsFull,
  getClientById,
  getClientFull,
  createClient,
  updateClient,
  deleteClient,
  createRelation,
  deleteRelation,
  getRelationsForEntity,
} from "@/lib/db";
import { prepare } from "@/lib/sql";
import type { Item, ItemPriority, ItemStatus, ItemType } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ItemTypeEnum = z.enum(["task", "note", "meeting", "plan", "idea"]);
const ItemStatusEnum = z.enum([
  "inbox", "todo", "in_progress", "review", "done", "archived",
]);
const ItemPriorityEnum = z.enum(["urgent", "high", "medium", "low", "none"]);

async function findRelationId(
  itemId: string,
  clientId: string,
): Promise<string | null> {
  const row = await prepare<{ id: string }>(
    `SELECT id FROM relations
     WHERE (source_type='item' AND source_id=? AND target_type='client' AND target_id=?)
        OR (source_type='client' AND source_id=? AND target_type='item' AND target_id=?)
     LIMIT 1`,
  ).get(itemId, clientId, clientId, itemId);
  return row?.id ?? null;
}

async function getClientIdsForItem(itemId: string): Promise<string[]> {
  const rows = await prepare<{ client_id: string }>(
    `SELECT CASE WHEN source_type='client' THEN source_id ELSE target_id END AS client_id
     FROM relations
     WHERE (source_type='item' AND source_id=? AND target_type='client')
        OR (source_type='client' AND target_type='item' AND target_id=?)`,
  ).all(itemId, itemId);
  return rows.map((r) => r.client_id);
}

async function getItemIdsForClient(clientId: string): Promise<string[]> {
  const rows = await prepare<{ item_id: string }>(
    `SELECT CASE WHEN source_type='item' THEN source_id ELSE target_id END AS item_id
     FROM relations
     WHERE (source_type='client' AND source_id=? AND target_type='item')
        OR (source_type='item' AND target_type='client' AND target_id=?)`,
  ).all(clientId, clientId);
  return rows.map((r) => r.item_id);
}

function ok(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function fail(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

const handler = createMcpRouteHandler(
  (server) => {
    // ---------------- Tasks ----------------

    server.tool(
      "tasks_list",
      "List tasks/items with filters. Returns array of items. Use 'overdue=true' for past-due tasks, 'has_due_date=false' for tasks without deadline, 'client_id' to filter by client.",
      {
        statuses: z.array(ItemStatusEnum).optional(),
        priorities: z.array(ItemPriorityEnum).optional(),
        types: z.array(ItemTypeEnum).optional(),
        category: z.string().optional(),
        search: z.string().optional().describe("Substring search in title/description"),
        has_due_date: z.boolean().optional(),
        overdue: z.boolean().optional().describe("Only tasks with due_date < today and not done/archived"),
        due_before: z.string().optional().describe("YYYY-MM-DD, due_date strictly before"),
        due_after: z.string().optional().describe("YYYY-MM-DD, due_date strictly after"),
        client_id: z.string().optional().describe("Only tasks linked to this client via relations"),
        include_archived: z.boolean().optional().default(false),
        limit: z.number().int().min(1).max(500).optional().default(100),
      },
      async (args) => {
        const allowedIds = args.client_id ? await getItemIdsForClient(args.client_id) : null;
        if (allowedIds && allowedIds.length === 0) return ok([]);

        let items = await getAllItems(args.include_archived, true);
        const today = new Date().toISOString().slice(0, 10);

        items = items.filter((it) => {
          if (args.statuses && !args.statuses.includes(it.status)) return false;
          if (args.priorities && !args.priorities.includes(it.priority)) return false;
          if (args.types && !args.types.includes(it.type)) return false;
          if (args.category && it.category !== args.category) return false;
          if (args.has_due_date === true && !it.due_date) return false;
          if (args.has_due_date === false && it.due_date) return false;
          if (args.overdue) {
            if (!it.due_date) return false;
            if (it.due_date >= today) return false;
            if (it.status === "done" || it.status === "archived") return false;
          }
          if (args.due_before && (!it.due_date || it.due_date >= args.due_before)) return false;
          if (args.due_after && (!it.due_date || it.due_date <= args.due_after)) return false;
          if (args.search) {
            const q = args.search.toLowerCase();
            const hay = `${it.title} ${it.description}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          if (allowedIds && !allowedIds.includes(it.id)) return false;
          return true;
        });

        return ok(items.slice(0, args.limit));
      },
    );

    server.tool(
      "tasks_get",
      "Get a single task by id with subtasks, tags, participants, and linked client_ids.",
      { id: z.string() },
      async ({ id }) => {
        const item = await getItemFull(id);
        if (!item) return fail(`Task ${id} not found`);
        const client_ids = await getClientIdsForItem(id);
        return ok({ ...item, client_ids });
      },
    );

    server.tool(
      "tasks_create",
      "Create a new task. Defaults: type=task, status=inbox, priority=none, source=claude. Optionally link clients by passing client_ids.",
      {
        title: z.string().min(1),
        description: z.string().optional().default(""),
        type: ItemTypeEnum.optional().default("task"),
        status: ItemStatusEnum.optional().default("inbox"),
        priority: ItemPriorityEnum.optional().default("none"),
        category: z.string().optional().default(""),
        due_date: z.string().nullable().optional().describe("YYYY-MM-DD"),
        due_time: z.string().nullable().optional().describe("HH:MM"),
        estimated_minutes: z.number().int().nullable().optional(),
        parent_id: z.string().nullable().optional(),
        client_ids: z.array(z.string()).optional(),
      },
      async (args) => {
        const id = randomUUID();
        const item = await createItem({
          id,
          title: args.title,
          description: args.description ?? "",
          type: args.type as ItemType,
          status: args.status as ItemStatus,
          priority: args.priority as ItemPriority,
          category: args.category ?? "",
          source: "claude",
          development_stage: null,
          due_date: args.due_date ?? null,
          due_time: args.due_time ?? null,
          estimated_minutes: args.estimated_minutes ?? null,
          position: 0,
          parent_id: args.parent_id ?? null,
        } as Omit<Item, "created_at" | "updated_at" | "recurring_series_id"> & { recurring_series_id?: string | null });

        if (args.client_ids?.length) {
          for (const cid of args.client_ids) {
            await createRelation({
              id: randomUUID(),
              source_type: "item",
              source_id: id,
              target_type: "client",
              target_id: cid,
            });
          }
        }
        return ok(item);
      },
    );

    server.tool(
      "tasks_update",
      "Update fields on a task. Any subset of: title, description, status, priority, due_date, due_time, category, estimated_minutes, type.",
      {
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        type: ItemTypeEnum.optional(),
        status: ItemStatusEnum.optional(),
        priority: ItemPriorityEnum.optional(),
        category: z.string().optional(),
        due_date: z.string().nullable().optional(),
        due_time: z.string().nullable().optional(),
        estimated_minutes: z.number().int().nullable().optional(),
        parent_id: z.string().nullable().optional(),
      },
      async ({ id, ...rest }) => {
        const updated = await updateItem(id, rest as Partial<Item>);
        if (!updated) return fail(`Task ${id} not found`);
        return ok(updated);
      },
    );

    server.tool(
      "tasks_delete",
      "Delete a task permanently. Prefer status=archived for soft-delete.",
      { id: z.string() },
      async ({ id }) => {
        const removed = await deleteItem(id);
        return removed ? ok({ deleted: id }) : fail(`Task ${id} not found`);
      },
    );

    server.tool(
      "tasks_assign_client",
      "Link a task to a client (creates a relation). Idempotent — does nothing if link already exists.",
      { task_id: z.string(), client_id: z.string() },
      async ({ task_id, client_id }) => {
        const existing = await findRelationId(task_id, client_id);
        if (existing) return ok({ relation_id: existing, already_linked: true });
        const created = await createRelation({
          id: randomUUID(),
          source_type: "item",
          source_id: task_id,
          target_type: "client",
          target_id: client_id,
        });
        if (!created) return fail("Failed to create relation (target may not exist)");
        return ok({ relation_id: created.id, already_linked: false });
      },
    );

    server.tool(
      "tasks_unassign_client",
      "Remove the link between a task and a client.",
      { task_id: z.string(), client_id: z.string() },
      async ({ task_id, client_id }) => {
        const relId = await findRelationId(task_id, client_id);
        if (!relId) return fail("No link between this task and client");
        await deleteRelation(relId);
        return ok({ unlinked: true });
      },
    );

    // ---------------- Clients ----------------

    server.tool(
      "clients_list",
      "List all clients with full nested data (status, companies, contacts, notes, links, crm_systems). Optional substring search by name.",
      {
        search: z.string().optional(),
        status_id: z.string().optional(),
      },
      async (args) => {
        let clients = await getAllClientsFull();
        if (args.search) {
          const q = args.search.toLowerCase();
          clients = clients.filter((c) => c.name.toLowerCase().includes(q));
        }
        if (args.status_id) {
          clients = clients.filter((c) => c.status_id === args.status_id);
        }
        return ok(clients);
      },
    );

    server.tool(
      "clients_get",
      "Get a client by id with all nested data and linked task ids.",
      { id: z.string() },
      async ({ id }) => {
        const client = await getClientFull(id);
        if (!client) return fail(`Client ${id} not found`);
        const task_ids = await getItemIdsForClient(id);
        return ok({ ...client, task_ids });
      },
    );

    server.tool(
      "clients_create",
      "Create a new client. Minimum: name. Optional: status_id, budget, operators_per_shift, operators_total, calls_per_month, crm_system.",
      {
        name: z.string().min(1),
        status_id: z.string().nullable().optional(),
        budget: z.string().optional(),
        operators_per_shift: z.string().optional(),
        operators_total: z.string().optional(),
        calls_per_month: z.string().optional(),
        crm_system: z.string().optional(),
      },
      async (args) => {
        const id = randomUUID();
        const client = await createClient({ id, ...args });
        return ok(client);
      },
    );

    server.tool(
      "clients_update",
      "Update client fields. Any subset of: name, status_id, budget, operators_per_shift, operators_total, calls_per_month, crm_system.",
      {
        id: z.string(),
        name: z.string().optional(),
        status_id: z.string().nullable().optional(),
        budget: z.string().optional(),
        operators_per_shift: z.string().optional(),
        operators_total: z.string().optional(),
        calls_per_month: z.string().optional(),
        crm_system: z.string().optional(),
      },
      async ({ id, ...rest }) => {
        const updated = await updateClient(id, rest);
        if (!updated) return fail(`Client ${id} not found`);
        return ok(updated);
      },
    );

    server.tool(
      "clients_delete",
      "Delete a client permanently. WARNING: this also cascades related data per FK rules.",
      { id: z.string() },
      async ({ id }) => {
        const removed = await deleteClient(id);
        return removed ? ok({ deleted: id }) : fail(`Client ${id} not found`);
      },
    );

    // ---------------- Relations (read) ----------------

    server.tool(
      "relations_for_entity",
      "List all relations attached to an entity (item or client) with target titles.",
      {
        entity_type: z.enum(["item", "client"]),
        entity_id: z.string(),
      },
      async ({ entity_type, entity_id }) => {
        const rels = await getRelationsForEntity(entity_type, entity_id);
        return ok(rels);
      },
    );

    // ---------------- Lookups ----------------

    server.tool(
      "lookup_categories",
      "List all available item categories (for use in tasks_create/update).",
      {},
      async () => {
        const rows = await prepare<{ id: string; name: string; color: string; icon: string; position: number }>(
          `SELECT id, name, color, icon, position FROM categories ORDER BY position`,
        ).all();
        return ok(rows);
      },
    );

    server.tool(
      "lookup_client_statuses",
      "List all client statuses.",
      {},
      async () => {
        const rows = await prepare<{ id: string; name: string; color: string }>(
          `SELECT id, name, color FROM client_statuses ORDER BY position`,
        ).all();
        return ok(rows);
      },
    );
  },
  {
    serverInfo: { name: "second-brain", version: "1.0.0" },
  },
  {
    basePath: "/api",
    disableSse: true,
    verboseLogs: false,
  },
);

const authHandler = withMcpAuth(
  handler,
  (_req, bearer) => {
    const expected = process.env.MCP_TOKEN;
    if (!expected || !bearer || bearer !== expected) return undefined;
    return {
      token: bearer,
      clientId: "second-brain-mcp",
      scopes: ["read", "write"],
    };
  },
  { required: true },
);

export const GET = authHandler;
export const POST = authHandler;
export const DELETE = authHandler;
