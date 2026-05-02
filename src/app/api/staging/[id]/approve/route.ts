import { NextRequest, NextResponse } from "next/server";
import {
  getStagingItemById, approveStagingItem, rejectStagingItem,
  createItem, getSubtasks, getItemTags,
  createClient as dbCreateClient,
  rebindExternalEntityLinks,
  getItemParticipants,
  setItemParticipants,
  setItemTags,
  syncClientNested,
  setClientCrmSystems,
  createRelation,
  getAllItems,
  getAllClients,
} from "@/lib/db";
import { v4 as uuid } from "uuid";
import type { StagingParsedData } from "@/types";
import { sanitizeRichText } from "@/lib/sanitize";

interface StagingRelation {
  target_type: "item" | "client";
  target_id?: string;
  target_title?: string;
  relation_type_id?: string | null;
}

async function resolveAndCreateRelations(
  sourceType: "item" | "client",
  sourceId: string,
  relations: StagingRelation[]
) {
  for (const rel of relations) {
    let targetId = rel.target_id;

    // If no target_id, try to resolve by title
    if (!targetId && rel.target_title) {
      if (rel.target_type === "item") {
        const items = await getAllItems(false, false);
        const match = items.find(
          (i) => i.title.toLowerCase() === rel.target_title!.toLowerCase()
        );
        if (match) targetId = match.id;
      } else {
        const clients = await getAllClients();
        const match = clients.find(
          (c) => c.name.toLowerCase() === rel.target_title!.toLowerCase()
        );
        if (match) targetId = match.id;
      }
    }

    if (!targetId) continue;

    await createRelation({
      id: uuid(),
      source_type: sourceType,
      source_id: sourceId,
      target_type: rel.target_type,
      target_id: targetId,
      relation_type_id: rel.relation_type_id ?? null,
    });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const action = body.action as "approve" | "reject";

    const staging = await getStagingItemById(id);
    if (!staging) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (action === "reject") {
      const rejected = await rejectStagingItem(id);
      return NextResponse.json(rejected);
    }

    // Approve: create actual entity
    const parsed: StagingParsedData = JSON.parse(staging.parsed_data || "{}");

    if (staging.entity_type === "item") {
      const itemId = uuid();
      const source = parsed.external_source === "kaiten" ? "kaiten" : "system";
      const item = await createItem({
        id: itemId,
        title: staging.title,
        description: sanitizeRichText(staging.description),
        type: parsed.type ?? "task",
        status: parsed.status ?? "inbox",
        priority: parsed.priority ?? "none",
        category: parsed.category ?? "other",
        source,
        development_stage: parsed.development_stage ?? null,
        due_date: parsed.due_date ?? null,
        due_time: null,
        estimated_minutes: null,
        position: 0,
        parent_id: parsed.parent_id ?? null,
      });

      if (parsed.participants?.length) {
        await setItemParticipants(itemId, parsed.participants);
      }

      // Set tags if any
      if (parsed.tags?.length) {
        await setItemTags(itemId, parsed.tags);
      }

      // Create subtasks if any
      if (parsed.subtasks?.length) {
        for (let i = 0; i < parsed.subtasks.length; i++) {
          const sub = parsed.subtasks[i];
          await createItem({
            id: uuid(),
            title: sub.title,
            description: sanitizeRichText(sub.description ?? ""),
            type: parsed.type ?? "task",
            status: "inbox",
            priority: "none",
            category: parsed.category ?? "other",
            source,
            development_stage: parsed.development_stage ?? null,
            due_date: null,
            due_time: null,
            estimated_minutes: null,
            position: i,
            parent_id: itemId,
          });
        }
      }

      // Create relations if any
      if (parsed.relations?.length) {
        await resolveAndCreateRelations("item", itemId, parsed.relations);
      }

      await approveStagingItem(id);
      await rebindExternalEntityLinks("item", id, itemId);

      const full = {
        ...item,
        subtasks: await getSubtasks(itemId),
        tags: await getItemTags(itemId),
        participants: await getItemParticipants(itemId),
      };
      return NextResponse.json(full, { status: 201 });
    }

    if (staging.entity_type === "client") {
      const clientId = uuid();
      const client = await dbCreateClient({
        id: clientId,
        name: staging.title,
        status_id: parsed.status_id ?? null,
        budget: parsed.budget ?? "",
        operators_per_shift: parsed.operators_per_shift ?? "",
        operators_total: parsed.operators_total ?? "",
        calls_per_month: parsed.calls_per_month ?? "",
        crm_system: parsed.crm_system ?? "",
      });

      // Sync nested client data (companies, contacts, notes, links)
      const nestedData: Parameters<typeof syncClientNested>[1] = {};
      if (parsed.companies?.length) nestedData.companies = parsed.companies;
      if (parsed.contacts?.length) nestedData.contacts = parsed.contacts;
      // Merge staging description into notes
      const allNotes = [...(parsed.notes ?? [])];
      if (staging.description?.trim()) {
        allNotes.unshift({ text: staging.description.trim() });
      }
      if (allNotes.length > 0) nestedData.notes = allNotes;
      if (parsed.links?.length) nestedData.links = parsed.links;
      if (Object.keys(nestedData).length > 0) {
        await syncClientNested(clientId, nestedData);
      }

      // Set CRM systems if any
      if (parsed.crm_system_ids?.length) {
        await setClientCrmSystems(clientId, parsed.crm_system_ids);
      }

      // Create relations if any
      if (parsed.relations?.length) {
        await resolveAndCreateRelations("client", clientId, parsed.relations);
      }

      await approveStagingItem(id);
      await rebindExternalEntityLinks("client", id, clientId);
      return NextResponse.json(client, { status: 201 });
    }

    return NextResponse.json({ error: "Unknown entity_type" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: "Failed to approve", detail: String(e) }, { status: 500 });
  }
}
