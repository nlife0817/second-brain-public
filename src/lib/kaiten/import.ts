import {
  KAITEN_DEFAULT_FIELD_MAPPINGS,
  KaitenImportResult,
  SyncFieldMapping,
  ItemPriority,
  ItemStatus,
  StagingParsedData,
} from "@/types";
import {
  createStagingItem,
  getExternalEntityLinkByRemote,
  getIntegrationSettings,
  getItemById,
  getIntegrationToken,
  getLatestSyncImportRun,
  getStagingItemById,
  setItemParticipants,
  getSyncFieldMappings,
  getSyncProfileById,
  saveSyncImportRun,
  updateItem,
  updateStagingItem,
  upsertExternalEntityLink,
  upsertSyncProfile,
} from "@/lib/db";
import {
  createKaitenClient,
  extractCardArchived,
  extractCardColumnId,
  extractCardDescription,
  extractCardDevelopmentStage,
  extractCardDueDate,
  extractCardLaneId,
  extractCardPriority,
  extractCardStatus,
  extractCardTags,
  extractCardTitle,
  KaitenApiError,
} from "@/lib/kaiten/client";
import { refreshKaitenCatalogForProfile } from "@/lib/kaiten/sync";

function mapPriority(value: string): ItemPriority {
  if (!value.trim()) return "none";
  if (value.includes("urgent")) return "urgent";
  if (value.includes("high")) return "high";
  if (value.includes("medium")) return "medium";
  if (value.includes("low")) return "low";
  return "none";
}

function mapPriorityOrNull(value: string): ItemPriority | null {
  if (!value.trim()) return null;
  const mapped = mapPriority(value);
  return mapped === "none" ? null : mapped;
}

function mapStatus(value: string): ItemStatus | null {
  if (!value.trim()) return null;
  const normalized = value.toLowerCase().replace(/\s+/g, "_");
  if (["inbox", "todo", "in_progress", "review", "done", "archived"].includes(normalized)) {
    return normalized as ItemStatus;
  }
  return null;
}

function applyMapping(card: Record<string, unknown>, mappings: SyncFieldMapping[]): StagingParsedData {
  const resolvedMappings = mappings.length
    ? mappings
    : KAITEN_DEFAULT_FIELD_MAPPINGS.map((mapping) => ({
        id: mapping.local_field,
        profile_id: "default",
        local_entity_type: "item" as const,
        local_field: mapping.local_field,
        remote_field: mapping.remote_field,
        direction: "import" as const,
        transform_rule: null,
        created_at: "",
        updated_at: "",
      }));

  const title = extractCardTitle(card);
  const statusValue = extractCardStatus(card);
  const dueDate = extractCardDueDate(card);
  const priorityValue = extractCardPriority(card);
  const tags = extractCardTags(card);
  const developmentStage = extractCardDevelopmentStage(card);

  const parsed: StagingParsedData = {
    external_source: "kaiten",
    external_id: String(card.id ?? ""),
    external_title: title,
    external_url: typeof card.url === "string" ? card.url : null,
    external_status: statusValue || null,
    external_board_id: typeof card.board_id === "number" ? card.board_id : typeof card.boardId === "number" ? card.boardId : null,
    external_board_name: typeof card.board_title === "string" ? card.board_title : null,
    external_space_id: typeof card.space_id === "number" ? card.space_id : typeof card.spaceId === "number" ? card.spaceId : null,
    external_space_name: typeof card.space_title === "string" ? card.space_title : null,
    external_column_id: extractCardColumnId(card),
    external_column_name: typeof card.column_title === "string" ? card.column_title : null,
    external_lane_id: extractCardLaneId(card),
    external_lane_name: typeof card.lane_title === "string" ? card.lane_title : null,
    external_updated_at: typeof card.updated === "string" ? card.updated : typeof card.updated_at === "string" ? card.updated_at : null,
    remote_payload: card,
    type: "task",
    status: null,
    priority: null,
    category: "development",
    development_stage: developmentStage,
    due_date: null,
  };

  for (const mapping of resolvedMappings) {
    switch (mapping.local_field) {
      case "status":
        parsed.status = mapStatus(statusValue);
        break;
      case "priority":
        parsed.priority = mapPriorityOrNull(priorityValue);
        break;
      case "due_date":
        parsed.due_date = dueDate;
        break;
      case "tags":
        parsed.tags = tags;
        break;
      default:
        break;
    }
  }

  return parsed;
}

export async function importKaitenProfile(profileId: string): Promise<KaitenImportResult> {
  const settings = await getIntegrationSettings("kaiten");
  const token = await getIntegrationToken("kaiten");
  const profile = await getSyncProfileById(profileId);

  if (!settings.enabled) {
    throw new KaitenApiError("Kaiten integration is disabled", 400);
  }
  if (!profile) {
    throw new KaitenApiError("Sync profile not found", 404);
  }
  if (!profile.source_board_id) {
    throw new KaitenApiError("Board is not configured for the sync profile", 400);
  }

  const mappings = await getSyncFieldMappings(profileId);
  const client = createKaitenClient({ baseUrl: settings.api_base_url, token });
  await refreshKaitenCatalogForProfile(profileId).catch(() => null);
  const batchId = crypto.randomUUID();
  const result: KaitenImportResult = {
    batch_id: batchId,
    profile_id: profileId,
    found: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    imported_ids: [],
    errors_detail: [],
  };

  const cards = await client.getCards(profile.source_board_id);
  const importedParticipants = new Map<string, { provider?: "kaiten" | null; remote_id?: string | null; name: string }>();
  const filtered = cards.filter((card) => {
    if (extractCardArchived(card)) return false;
    const status = extractCardStatus(card);
    const columnId = extractCardColumnId(card);
    const laneId = extractCardLaneId(card);
    if (profile.source_statuses.length > 0 && !profile.source_statuses.includes(status)) return false;
    if (profile.source_columns.length > 0 && (!columnId || !profile.source_columns.includes(String(columnId)))) return false;
    if (profile.source_lanes.length > 0 && (!laneId || !profile.source_lanes.includes(String(laneId)))) return false;
    return true;
  });

  result.found = filtered.length;

  for (const card of filtered) {
    try {
      const remoteId = String(card.id ?? "");
      if (!remoteId) {
        result.skipped += 1;
        continue;
      }

      const remoteNumericId = Number(remoteId);
      const enrichedCard = Number.isFinite(remoteNumericId)
        ? await client.getCard(remoteNumericId).catch(() => card)
        : card;
      if (extractCardArchived(enrichedCard)) {
        result.skipped += 1;
        continue;
      }
      const participants = Number.isFinite(remoteNumericId)
        ? await client.getCardMembers(remoteNumericId).catch(() => [])
        : [];
      for (const participant of participants) {
        const key = participant.remote_id?.trim()
          ? `kaiten:${participant.remote_id}`
          : participant.name.trim().toLowerCase();
        importedParticipants.set(key, participant);
      }

      const link = await getExternalEntityLinkByRemote("kaiten", "card", remoteId);
      const parsed = applyMapping(enrichedCard, mappings);
      parsed.participants = participants;
      const title = extractCardTitle(enrichedCard) || `Kaiten #${remoteId}`;
      const description = extractCardDescription(enrichedCard);

      if (link) {
        const staging = await getStagingItemById(link.local_entity_id);
        if (staging) {
          await updateStagingItem(staging.id, {
            title,
            description,
            parsed_data: JSON.stringify(parsed),
            entity_type: "item",
            staging_status: "pending",
            batch_id: batchId,
          });
          result.updated += 1;
          result.imported_ids.push(staging.id);
          await upsertExternalEntityLink({
            provider: "kaiten",
            profile_id: profile.id,
            local_entity_type: "item",
            local_entity_id: staging.id,
            remote_entity_type: "card",
            remote_entity_id: remoteId,
            remote_space_id: parsed.external_space_id ?? null,
            remote_board_id: parsed.external_board_id ?? profile.source_board_id,
            remote_column_id: parsed.external_column_id ?? null,
            remote_lane_id: parsed.external_lane_id ?? null,
            last_remote_updated_at: parsed.external_updated_at ?? null,
            sync_state: "pending",
            last_error: null,
          });
          continue;
        }

        const item = await getItemById(link.local_entity_id);
        if (item) {
          await updateItem(item.id, {
            title,
            description,
            type: "task",
            category: "development",
            development_stage: parsed.development_stage ?? null,
            status: parsed.status ?? item.status,
            priority: parsed.priority ?? item.priority,
            due_date: parsed.due_date ?? null,
          });
          await setItemParticipants(item.id, participants);
          result.updated += 1;
          result.imported_ids.push(item.id);
          await upsertExternalEntityLink({
            provider: "kaiten",
            profile_id: profile.id,
            local_entity_type: "item",
            local_entity_id: item.id,
            remote_entity_type: "card",
            remote_entity_id: remoteId,
            remote_space_id: parsed.external_space_id ?? null,
            remote_board_id: parsed.external_board_id ?? profile.source_board_id,
            remote_column_id: parsed.external_column_id ?? null,
            remote_lane_id: parsed.external_lane_id ?? null,
            last_remote_updated_at: parsed.external_updated_at ?? null,
            sync_state: "active",
            last_error: null,
          });
          continue;
        }
      }

      const staging = await createStagingItem({
        id: crypto.randomUUID(),
        entity_type: "item",
        title,
        description,
        parsed_data: JSON.stringify(parsed),
        batch_id: batchId,
      });
      await upsertExternalEntityLink({
        provider: "kaiten",
        profile_id: profile.id,
        local_entity_type: "item",
        local_entity_id: staging.id,
        remote_entity_type: "card",
        remote_entity_id: remoteId,
        remote_space_id: parsed.external_space_id ?? null,
        remote_board_id: parsed.external_board_id ?? profile.source_board_id,
        remote_column_id: parsed.external_column_id ?? null,
        remote_lane_id: parsed.external_lane_id ?? null,
        last_remote_updated_at: parsed.external_updated_at ?? null,
        sync_state: "pending",
        last_error: null,
      });
      result.created += 1;
      result.imported_ids.push(staging.id);
    } catch (error) {
      result.errors += 1;
      result.errors_detail.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (importedParticipants.size > 0) {
    await upsertSyncProfile("kaiten", {
      ...profile,
      available_participants: Array.from(
        new Map(
          [...profile.available_participants, ...importedParticipants.values()].map((participant) => [
            participant.remote_id?.trim()
              ? `kaiten:${participant.remote_id}`
              : participant.name.trim().toLowerCase(),
            participant,
          ])
        ).values()
      ),
    });
  }

  await saveSyncImportRun("kaiten", profileId, result);
  return result;
}

export async function getLatestKaitenImport(profileId: string) {
  return await getLatestSyncImportRun(profileId);
}
