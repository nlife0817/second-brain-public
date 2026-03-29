import { NextRequest, NextResponse } from "next/server";
import {
  getStagingItemById, approveStagingItem, rejectStagingItem,
  createItem, getSubtasks, getItemTags,
  createClient as dbCreateClient,
  rebindExternalEntityLinks,
  getItemParticipants,
  setItemParticipants,
} from "@/lib/db";
import { v4 as uuid } from "uuid";
import type { StagingParsedData } from "@/types";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const action = body.action as "approve" | "reject";

    const staging = getStagingItemById(id);
    if (!staging) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (action === "reject") {
      const rejected = rejectStagingItem(id);
      return NextResponse.json(rejected);
    }

    // Approve: create actual entity
    const parsed: StagingParsedData = JSON.parse(staging.parsed_data || "{}");

    if (staging.entity_type === "item") {
      const itemId = uuid();
      const source = parsed.external_source === "kaiten" ? "kaiten" : "system";
      const item = createItem({
        id: itemId,
        title: staging.title,
        description: staging.description,
        type: parsed.type ?? "task",
        status: parsed.status ?? "inbox",
        priority: parsed.priority ?? "none",
        category: parsed.category ?? "other",
        source,
        development_stage: parsed.development_stage ?? null,
        due_date: parsed.due_date ?? null,
        position: 0,
        parent_id: parsed.parent_id ?? null,
      });

      if (parsed.participants?.length) {
        setItemParticipants(itemId, parsed.participants);
      }

      // Create subtasks if any
      if (parsed.subtasks?.length) {
        for (let i = 0; i < parsed.subtasks.length; i++) {
          const sub = parsed.subtasks[i];
          createItem({
            id: uuid(),
            title: sub.title,
            description: sub.description ?? "",
            type: parsed.type ?? "task",
            status: "inbox",
            priority: "none",
            category: parsed.category ?? "other",
            source,
            development_stage: parsed.development_stage ?? null,
            due_date: null,
            position: i,
            parent_id: itemId,
          });
        }
      }

      approveStagingItem(id);
      rebindExternalEntityLinks("item", id, itemId);

      const full = {
        ...item,
        subtasks: getSubtasks(itemId),
        tags: getItemTags(itemId),
        participants: getItemParticipants(itemId),
      };
      return NextResponse.json(full, { status: 201 });
    }

    if (staging.entity_type === "client") {
      const client = dbCreateClient({
        id: uuid(),
        name: staging.title,
        status_id: parsed.status_id ?? null,
        budget: parsed.budget ?? "",
        operators_per_shift: parsed.operators_per_shift ?? "",
        operators_total: parsed.operators_total ?? "",
        calls_per_month: parsed.calls_per_month ?? "",
        crm_system: parsed.crm_system ?? "",
      });

      approveStagingItem(id);
      rebindExternalEntityLinks("client", id, client.id);
      return NextResponse.json(client, { status: 201 });
    }

    return NextResponse.json({ error: "Unknown entity_type" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: "Failed to approve", detail: String(e) }, { status: 500 });
  }
}
