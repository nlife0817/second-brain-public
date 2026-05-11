import type {
  Item,
  ItemPriority,
  ItemStatus,
  KaitenStageOption,
  SyncProfile,
} from "@/types";
import {
  deleteSyncOutboxJob,
  getAllSyncProfiles,
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
  getInitiativeIdByKaitenBoard,
} from "@/lib/db";
import {
  buildBoardStageOptions,
  createKaitenClient,
  extractCardArchived,
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

const IMG_TAG_SRC_PATTERN = /(<img\b[^>]*\bsrc=(["']))([^"']+)(\2[^>]*>)/gi;

function looksLikeDataUrl(value: string) {
  return value.startsWith("data:");
}

function stripEmbeddedDataImages(description: string) {
  if (!description.trim()) return description;
  return description.replace(
    /<img\b[^>]*\bsrc=(["'])data:[^"']+\1[^>]*>/gi,
    ""
  );
}

function mimeTypeToExtension(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "image/bmp":
      return "bmp";
    default:
      return "bin";
  }
}

function parseDataUrl(value: string) {
  const match = value.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]+)$/i);
  if (!match) return null;

  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";

  return {
    mimeType,
    bytes: isBase64
      ? Uint8Array.from(Buffer.from(payload, "base64"))
      : Uint8Array.from(Buffer.from(decodeURIComponent(payload), "utf8")),
  };
}

async function syncEmbeddedImagesToKaitenCard(
  client: ReturnType<typeof createKaitenClient>,
  cardId: number,
  description: string
) {
  if (!description.trim() || !description.includes("<img")) {
    return description;
  }

  const uploads = new Map<string, string>();
  let imageIndex = 0;
  const matches = Array.from(description.matchAll(IMG_TAG_SRC_PATTERN));

  for (const match of matches) {
    const src = match[3];
    if (!src || !looksLikeDataUrl(src) || uploads.has(src)) {
      continue;
    }

    const parsed = parseDataUrl(src);
    if (!parsed) {
      throw new Error("Unable to parse embedded image for Kaiten sync.");
    }

    imageIndex += 1;
    const uploaded = await client.uploadCardFile(cardId, {
      filename: `second-brain-${cardId}-${imageIndex}.${mimeTypeToExtension(parsed.mimeType)}`,
      mimeType: parsed.mimeType,
      bytes: parsed.bytes,
    });
    const uploadedUrl =
      typeof uploaded.url === "string"
        ? uploaded.url
        : typeof uploaded.thumbnail_url === "string"
          ? uploaded.thumbnail_url
          : null;

    if (!uploadedUrl) {
      throw new Error("Kaiten did not return uploaded image url.");
    }

    uploads.set(src, uploadedUrl);
  }

  if (uploads.size === 0) {
    return description;
  }

  return description.replace(
    IMG_TAG_SRC_PATTERN,
    (_full, prefix: string, quote: string, src: string, suffix: string) =>
      `${prefix}${uploads.get(src) ?? src}${suffix}`
  );
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

async function getEligibleExportProfiles(preferredProfileId?: string | null) {
  const preferredProfile = preferredProfileId
    ? await getSyncProfileById(preferredProfileId)
    : undefined;

  const profiles = preferredProfile
    ? [preferredProfile]
    : await getAllSyncProfiles("kaiten");

  return profiles.filter(
    (profile): profile is SyncProfile =>
      Boolean(
        profile
        && profile.export_enabled
        && profile.source_space_id
        && profile.source_board_id
      )
  );
}

function findProfileStageMatch(profile: SyncProfile, value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  return profile.available_development_stages.find(
    (option) => option.value === normalized || option.label === normalized
  );
}

async function pickKaitenExportProfile(
  item: Item,
  preferredProfileId?: string | null
) {
  const profiles = await getEligibleExportProfiles(preferredProfileId);
  if (profiles.length === 0) return undefined;

  const directMatch = profiles.find((profile) =>
    Boolean(findProfileStageMatch(profile, item.development_stage))
  );
  if (directMatch) return directMatch;

  return profiles[0];
}

function resolveStageOption(
  profile: SyncProfile,
  stageValue?: string | null
): KaitenStageOption | null {
  const directMatch = findProfileStageMatch(profile, stageValue);
  if (directMatch) return directMatch;

  const filteredMatch = profile.available_development_stages.find((option) => {
    const columnMatches =
      profile.source_columns.length === 0
      || (option.column_title
        ? profile.source_columns.includes(option.column_title)
        : false)
      || profile.source_columns.includes(option.label);
    const laneMatches =
      profile.source_lanes.length === 0
      || option.lane_title === null
      || profile.source_lanes.includes(option.lane_title);
    return columnMatches && laneMatches;
  });
  if (filteredMatch) return filteredMatch;

  return profile.available_development_stages[0] ?? null;
}

async function createRemoteCardForItem(
  client: ReturnType<typeof createKaitenClient>,
  profile: SyncProfile,
  item: Item
) {
  if (!profile.source_board_id) {
    throw new Error("Board is not configured for the sync profile.");
  }

  const stageOption = resolveStageOption(profile, item.development_stage);
  const payload: Record<string, unknown> = {
    board_id: profile.source_board_id,
    title: item.title,
    position: 2,
  };

  if (item.description.trim()) {
    payload.description = stripEmbeddedDataImages(item.description);
  }
  if (item.due_date) {
    payload.due_date = item.due_date;
  }
  if (stageOption?.column_id) {
    payload.column_id = stageOption.column_id;
  }
  if (stageOption?.lane_id) {
    payload.lane_id = stageOption.lane_id;
  }

  return await client.createCard(payload);
}

export async function refreshKaitenCatalogForProfile(profileId: string): Promise<SyncProfile> {
  const settings = await getIntegrationSettings("kaiten");
  const token = await getIntegrationToken("kaiten");
  const profile = await getSyncProfileById(profileId);

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

  return await upsertSyncProfile("kaiten", {
    ...profile,
    available_development_stages: stageOptions,
    available_participants: participants,
    last_catalog_synced_at: nowIso(),
  });
}

export async function queueKaitenItemSync(itemId: string) {
  const item = await getItemById(itemId);
  if (!item) return false;

  const link = await getExternalEntityLinkByLocal("kaiten", "item", itemId);
  if (!link || link.remote_entity_type !== "card") {
    if (item.category !== "development") return false;

    const profile = await pickKaitenExportProfile(item);
    if (!profile) return false;

    await upsertSyncOutboxJob({
      provider: "kaiten",
      profile_id: profile.id,
      local_entity_type: "item",
      local_entity_id: itemId,
      remote_entity_type: "card",
      remote_entity_id: "",
      next_attempt_at: addMinutes(
        new Date(),
        profile.sync_interval_minutes || 60
      ),
    });

    return true;
  }

  const profile =
    (link.profile_id ? await getSyncProfileById(link.profile_id) : undefined)
    ?? (link.remote_board_id ? await getSyncProfileByBoard("kaiten", link.remote_board_id) : undefined);

  if (!profile || !profile.export_enabled) return false;

  await upsertSyncOutboxJob({
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
  const settings = await getIntegrationSettings("kaiten");
  const token = await getIntegrationToken("kaiten");
  const client = createKaitenClient({ baseUrl: settings.api_base_url, token });
  const card = await client.getCard(cardId);
  const participants = await client.getCardMembers(cardId).catch(() => []);

  const resolvedStatus = extractCardArchived(card)
    ? "archived" as ItemStatus
    : mapStatus(extractCardStatus(card)) ?? "inbox";

  // Planning hook: auto-attach to initiative if the source board is mapped.
  const boardId = extractCardColumnId(card) != null ? (card as { board_id?: number | string }).board_id ?? profile.source_board_id : profile.source_board_id;
  const mappedInitiativeId = await getInitiativeIdByKaitenBoard(boardId ?? null);
  const currentLocal = await getItemById(localItemId);
  const updates: Parameters<typeof updateItem>[1] = {
    title: extractCardTitle(card) || `Kaiten #${cardId}`,
    description: extractCardDescription(card),
    type: "task",
    category: "development",
    development_stage: extractCardDevelopmentStage(card),
    status: resolvedStatus,
    priority: mapPriority(extractCardPriority(card)) ?? "none",
    due_date: extractCardDueDate(card) ?? null,
  };
  if (mappedInitiativeId && !currentLocal?.initiative_id) {
    updates.initiative_id = mappedInitiativeId;
  }
  await updateItem(localItemId, updates);
  await setItemParticipants(localItemId, participants);

  // Planning §6.3: fallback to "Поддержка Qx" if neither user nor mapping set initiative.
  const afterLocal = await getItemById(localItemId);
  if (afterLocal && !afterLocal.initiative_id) {
    const { autoLinkOrphanTaskToSupport } = await import("@/lib/db");
    await autoLinkOrphanTaskToSupport(localItemId).catch(() => undefined);
  }

  await upsertExternalEntityLink({
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

export async function runDueKaitenSync(options?: { force?: boolean }) {
  const settings = await getIntegrationSettings("kaiten");
  const token = await getIntegrationToken("kaiten");
  if (!settings.enabled || !token) {
    return { processed: 0, exported: 0, remote_overrides: 0, errors: 0 };
  }

  const jobs = await getDueSyncOutboxJobs("kaiten", 50, options?.force === true);
  if (jobs.length === 0) {
    return { processed: 0, exported: 0, remote_overrides: 0, errors: 0 };
  }

  const client = createKaitenClient({ baseUrl: settings.api_base_url, token });
  const result = { processed: 0, exported: 0, remote_overrides: 0, errors: 0 };

  for (const job of jobs) {
    result.processed += 1;
    await markSyncOutboxProcessing(job.id);

    try {
      const link = await getExternalEntityLinkByLocal(
        "kaiten",
        job.local_entity_type,
        job.local_entity_id
      );
      const item = await getItemById(job.local_entity_id);

      if (!item || job.local_entity_type !== "item") {
        await deleteSyncOutboxJob(job.id);
        continue;
      }

      const profile =
        (job.profile_id ? await getSyncProfileById(job.profile_id) : undefined)
        ?? (link?.profile_id ? await getSyncProfileById(link.profile_id) : undefined)
        ?? (link?.remote_board_id ? await getSyncProfileByBoard("kaiten", link.remote_board_id) : undefined)
        ?? await pickKaitenExportProfile(item, job.profile_id);

      if (!profile || !profile.export_enabled) {
        await deleteSyncOutboxJob(job.id);
        continue;
      }

      const syncedProfile =
        profile.available_development_stages.length === 0
        || profile.available_participants.length === 0
          ? await refreshKaitenCatalogForProfile(profile.id).catch(() => profile)
          : profile;

      if (!link) {
        const createdCard = await createRemoteCardForItem(
          client,
          syncedProfile,
          item
        );
        const createdCardId = Number(createdCard.id);
        if (!Number.isFinite(createdCardId)) {
          throw new Error("Kaiten did not return created card id.");
        }

        const createdDescription = await syncEmbeddedImagesToKaitenCard(
          client,
          createdCardId,
          item.description
        );
        if (createdDescription !== stripEmbeddedDataImages(item.description)) {
          await client.updateCard(createdCardId, {
            description: createdDescription,
          });
        }
        if (createdDescription !== item.description) {
          await updateItem(item.id, { description: createdDescription });
        }

        await client.syncCardMembers(createdCardId, await getItemParticipants(item.id));

        await upsertExternalEntityLink({
          provider: "kaiten",
          profile_id: syncedProfile.id,
          local_entity_type: "item",
          local_entity_id: item.id,
          remote_entity_type: "card",
          remote_entity_id: String(createdCardId),
          remote_space_id: syncedProfile.source_space_id,
          remote_board_id: syncedProfile.source_board_id,
          remote_column_id: extractCardColumnId(createdCard),
          remote_lane_id: extractCardLaneId(createdCard),
          last_remote_updated_at:
            typeof createdCard.updated === "string"
              ? createdCard.updated
              : typeof createdCard.updated_at === "string"
                ? createdCard.updated_at
                : nowIso(),
          last_local_synced_at: nowIso(),
          sync_state: "active",
          last_error: null,
        });

        await deleteSyncOutboxJob(job.id);
        result.exported += 1;
        continue;
      }

      const remoteCardId = Number(link.remote_entity_id);
      if (!Number.isFinite(remoteCardId)) {
        await deleteSyncOutboxJob(job.id);
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
        await deleteSyncOutboxJob(job.id);
        result.remote_overrides += 1;
        continue;
      }

      const stageMatch = syncedProfile.available_development_stages.find(
        (option) => option.value === item.development_stage || option.label === item.development_stage
      );

      const updatePayload: Record<string, unknown> = {
        title: item.title,
        due_date: item.due_date,
      };
      const syncedDescription = await syncEmbeddedImagesToKaitenCard(
        client,
        remoteCardId,
        item.description
      );
      updatePayload.description = syncedDescription;

      if (stageMatch?.column_id) {
        updatePayload.column_id = stageMatch.column_id;
      }
      if (stageMatch?.lane_id) {
        updatePayload.lane_id = stageMatch.lane_id;
      }

      await client.updateCard(remoteCardId, updatePayload);
      await client.syncCardMembers(remoteCardId, await getItemParticipants(item.id));
      if (syncedDescription !== item.description) {
        await updateItem(item.id, { description: syncedDescription });
      }

      // Sync archive state: local archived → archive in Kaiten, local active → unarchive in Kaiten
      const remoteIsArchived = extractCardArchived(remoteCard);
      if (item.status === "archived" && !remoteIsArchived) {
        await client.archiveCard(remoteCardId);
      } else if (item.status !== "archived" && remoteIsArchived) {
        await client.unarchiveCard(remoteCardId);
      }

      const syncedCard = await client.getCard(remoteCardId);
      const syncedUpdatedAt =
        typeof syncedCard.updated === "string"
          ? syncedCard.updated
          : typeof syncedCard.updated_at === "string"
            ? syncedCard.updated_at
            : nowIso();

      await upsertExternalEntityLink({
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

      await deleteSyncOutboxJob(job.id);
      result.exported += 1;
    } catch (error) {
      result.errors += 1;
      await markSyncOutboxError(
        job.id,
        addMinutes(new Date(), 10),
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return result;
}

// Scheduler moved to Vercel Cron. Kept as a no-op stub for backward compatibility
// with any route handler still invoking it.
export function ensureKaitenSyncScheduler() {}
