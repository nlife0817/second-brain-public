import type {
  ItemPriority,
  ItemStatus,
  SyncProfile,
} from "@/types";
import {
  deleteSyncOutboxJob,
  getDueSyncOutboxJobs,
  getExternalEntityLinkByLocal,
  getIntegrationSettings,
  getIntegrationToken,
  getItemById,
  getItemParticipants,
  getSyncProfileByBoard,
  getSyncProfileById,
  markSyncOutboxError,
  markSyncOutboxProcessing,
  setItemParticipants,
  updateItem,
  upsertExternalEntityLink,
  upsertSyncOutboxJob,
  upsertSyncProfile,
} from "@/lib/db";
import {
  buildBoardStageOptions,
  createKaitenClient,
  extractCardColumnId,
  extractCardDescription,
  extractCardDevelopmentStage,
  extractCardDueDate,
  extractCardLaneId,
  extractCardPriority,
  extractCardStatus,
  extractCardTitle,
} from "@/lib/kaiten/client";

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000).toISOString();
}

function mapStatus(value: string): ItemStatus | null {
  if (!value.trim()) return null;
  const normalized = value.toLowerCase().replace(/\s+/g, "_");
  if (["inbox", "todo", "in_progress", "review", "done", "archived"].includes(normalized)) {
    return normalized as ItemStatus;
  }
  return null;
}

function mapPriority(value: string): ItemPriority | null {
  const normalized = value.toLowerCase();
  if (!normalized.trim()) return null;
  if (normalized.includes("urgent")) return "urgent";
  if (normalized.includes("high")) return "high";
  if (normalized.includes("medium")) return "medium";
  if (normalized.includes("low")) return "low";
  return null;
}

export async function refreshKaitenCatalogForProfile(profileId: string): Promise<SyncProfile> {
  const settings = getIntegrationSettings("kaiten");
  const token = getIntegrationToken("kaiten");
  const profile = getSyncProfileById(profileId);

  if (!profile) {
    throw new Error("Sync profile not found");
  }

  if (!settings.company_domain || !token || !profile.source_space_id) {
    return profile;
  }

  const client = createKaitenClient({ baseUrl: settings.api_base_url, token });
  const boards = await client.getBoards(profile.source_space_id);
  const board = boards.find((item) => item.id === profile.source_board_id) ?? null;
  const stageOptions = board ? buildBoardStageOptions(board) : [];
  const participants = await client.getSpaceUsers(profile.source_space_id).catch(() => []);

  return upsertSyncProfile("kaiten", {
    ...profile,
    available_development_stages: stageOptions,
    available_participants: participants,
    last_catalog_synced_at: nowIso(),
  });
}

export function queueKaitenItemSync(itemId: string) {
  const link = getExternalEntityLinkByLocal("kaiten", "item", itemId);
  if (!link || link.remote_entity_type !== "card") return false;

  const profile =
    (link.profile_id ? getSyncProfileById(link.profile_id) : undefined)
    ?? (link.remote_board_id ? getSyncProfileByBoard("kaiten", link.remote_board_id) : undefined);

  if (!profile || !profile.export_enabled) return false;

  upsertSyncOutboxJob({
    provider: "kaiten",
    profile_id: profile.id,
    local_entity_type: "item",
    local_entity_id: itemId,
    remote_entity_type: "card",
    remote_entity_id: link.remote_entity_id,
    next_attempt_at: addMinutes(new Date(), profile.sync_interval_minutes || 60),
  });

  return true;
}

async function applyRemoteCardToItem(cardId: number, profile: SyncProfile, localItemId: string) {
  const settings = getIntegrationSettings("kaiten");
  const token = getIntegrationToken("kaiten");
  const client = createKaitenClient({ baseUrl: settings.api_base_url, token });
  const card = await client.getCard(cardId);
  const participants = await client.getCardMembers(cardId).catch(() => []);

  updateItem(localItemId, {
    title: extractCardTitle(card) || `Kaiten #${cardId}`,
    description: extractCardDescription(card),
    type: "task",
    category: "development",
    development_stage: extractCardDevelopmentStage(card),
    status: mapStatus(extractCardStatus(card)) ?? "inbox",
    priority: mapPriority(extractCardPriority(card)) ?? "none",
    due_date: extractCardDueDate(card) ?? null,
  });
  setItemParticipants(localItemId, participants);

  upsertExternalEntityLink({
    provider: "kaiten",
    profile_id: profile.id,
    local_entity_type: "item",
    local_entity_id: localItemId,
    remote_entity_type: "card",
    remote_entity_id: String(cardId),
    remote_space_id: profile.source_space_id,
    remote_board_id: profile.source_board_id,
    remote_column_id: extractCardColumnId(card),
    remote_lane_id: extractCardLaneId(card),
    last_remote_updated_at:
      typeof card.updated === "string"
        ? card.updated
        : typeof card.updated_at === "string"
          ? card.updated_at
          : nowIso(),
    last_local_synced_at: nowIso(),
    sync_state: "active",
    last_error: null,
  });
}

export async function runDueKaitenSync() {
  const settings = getIntegrationSettings("kaiten");
  const token = getIntegrationToken("kaiten");
  if (!settings.enabled || !token) {
    return { processed: 0, exported: 0, remote_overrides: 0, errors: 0 };
  }

  const jobs = getDueSyncOutboxJobs("kaiten");
  if (jobs.length === 0) {
    return { processed: 0, exported: 0, remote_overrides: 0, errors: 0 };
  }

  const client = createKaitenClient({ baseUrl: settings.api_base_url, token });
  const result = { processed: 0, exported: 0, remote_overrides: 0, errors: 0 };

  for (const job of jobs) {
    result.processed += 1;
    markSyncOutboxProcessing(job.id);

    try {
      const link = getExternalEntityLinkByLocal(
        "kaiten",
        job.local_entity_type,
        job.local_entity_id
      );
      const item = getItemById(job.local_entity_id);

      if (!link || !item || job.local_entity_type !== "item") {
        deleteSyncOutboxJob(job.id);
        continue;
      }

      const profile =
        (job.profile_id ? getSyncProfileById(job.profile_id) : undefined)
        ?? (link.profile_id ? getSyncProfileById(link.profile_id) : undefined)
        ?? (link.remote_board_id ? getSyncProfileByBoard("kaiten", link.remote_board_id) : undefined);

      if (!profile || !profile.export_enabled) {
        deleteSyncOutboxJob(job.id);
        continue;
      }

      const syncedProfile =
        profile.available_development_stages.length === 0
        || profile.available_participants.length === 0
          ? await refreshKaitenCatalogForProfile(profile.id).catch(() => profile)
          : profile;

      const remoteCardId = Number(link.remote_entity_id);
      if (!Number.isFinite(remoteCardId)) {
        deleteSyncOutboxJob(job.id);
        continue;
      }

      const remoteCard = await client.getCard(remoteCardId);
      const remoteUpdatedAt =
        typeof remoteCard.updated === "string"
          ? remoteCard.updated
          : typeof remoteCard.updated_at === "string"
            ? remoteCard.updated_at
            : null;

      const remoteChanged =
        Boolean(remoteUpdatedAt && link.last_remote_updated_at)
        && new Date(remoteUpdatedAt as string).getTime() > new Date(link.last_remote_updated_at as string).getTime();

      if (remoteChanged && syncedProfile.remote_wins_on_conflict) {
        await applyRemoteCardToItem(remoteCardId, syncedProfile, item.id);
        deleteSyncOutboxJob(job.id);
        result.remote_overrides += 1;
        continue;
      }

      const stageMatch = syncedProfile.available_development_stages.find(
        (option) => option.value === item.development_stage || option.label === item.development_stage
      );

      const updatePayload: Record<string, unknown> = {
        title: item.title,
        description: item.description,
        due_date: item.due_date,
      };

      if (stageMatch?.column_id) {
        updatePayload.column_id = stageMatch.column_id;
      }
      if (stageMatch?.lane_id) {
        updatePayload.lane_id = stageMatch.lane_id;
      }

      await client.updateCard(remoteCardId, updatePayload);
      await client.syncCardMembers(remoteCardId, getItemParticipants(item.id));
      const syncedCard = await client.getCard(remoteCardId);
      const syncedUpdatedAt =
        typeof syncedCard.updated === "string"
          ? syncedCard.updated
          : typeof syncedCard.updated_at === "string"
            ? syncedCard.updated_at
            : nowIso();

      upsertExternalEntityLink({
        provider: "kaiten",
        profile_id: syncedProfile.id,
        local_entity_type: "item",
        local_entity_id: item.id,
        remote_entity_type: "card",
        remote_entity_id: link.remote_entity_id,
        remote_space_id: link.remote_space_id ?? syncedProfile.source_space_id,
        remote_board_id: link.remote_board_id ?? syncedProfile.source_board_id,
        remote_column_id: extractCardColumnId(syncedCard) ?? link.remote_column_id,
        remote_lane_id: extractCardLaneId(syncedCard) ?? link.remote_lane_id,
        last_remote_updated_at: syncedUpdatedAt,
        last_local_synced_at: nowIso(),
        sync_state: "active",
        last_error: null,
      });

      deleteSyncOutboxJob(job.id);
      result.exported += 1;
    } catch (error) {
      result.errors += 1;
      markSyncOutboxError(
        job.id,
        addMinutes(new Date(), 10),
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return result;
}

export function ensureKaitenSyncScheduler() {
  const globalState = globalThis as typeof globalThis & {
    __secondBrainKaitenSyncInterval?: ReturnType<typeof setInterval>;
  };

  if (globalState.__secondBrainKaitenSyncInterval) return;

  globalState.__secondBrainKaitenSyncInterval = setInterval(() => {
    void runDueKaitenSync();
  }, 5 * 60 * 1000);
}
