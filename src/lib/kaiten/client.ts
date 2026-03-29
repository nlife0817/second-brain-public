import type { KaitenBoardOption, KaitenSpace } from "@/types";

export class KaitenApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "KaitenApiError";
    this.status = status;
  }
}

type KaitenClientOptions = {
  baseUrl: string;
  token: string;
};

let lastKaitenRequestAt = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function imageMarkdownToHtml(value: string) {
  return value.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)/g, (_match, alt, src) => {
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`;
  });
}

function plainTextToHtml(value: string) {
  const normalized = value.trim();
  if (!normalized) return "";
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function normalizeDescriptionMarkup(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (looksLikeHtml(trimmed)) return trimmed;

  const markdownWithImages = imageMarkdownToHtml(trimmed);
  if (markdownWithImages !== trimmed) {
    return markdownWithImages
      .split(/\n{2,}/)
      .map((paragraph) => {
        if (/<img[\s\S]*>/i.test(paragraph)) return `<p>${paragraph.replace(/\n/g, "<br />")}</p>`;
        return `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`;
      })
      .join("");
  }

  return plainTextToHtml(trimmed);
}

function isImageFile(file: Record<string, unknown>) {
  const mimeType = readString(file.mime_type).toLowerCase();
  const url = readString(file.url || file.thumbnail_url).toLowerCase();
  const name = readString(file.name).toLowerCase();
  return mimeType.startsWith("image/")
    || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(url)
    || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name);
}

function extractCardImageUrls(card: Record<string, unknown>) {
  return asArray<Record<string, unknown>>(card.files)
    .filter((file) => !file.deleted && isImageFile(file))
    .map((file) => readString(file.url || file.thumbnail_url))
    .filter(Boolean);
}

function appendImageGallery(descriptionHtml: string, imageUrls: string[]) {
  if (imageUrls.length === 0) return descriptionHtml;

  const missingImageUrls = imageUrls.filter((url) => !descriptionHtml.includes(url));
  if (missingImageUrls.length === 0) return descriptionHtml;

  const galleryHtml = missingImageUrls
    .map((url) => `<p><img src="${escapeHtml(url)}" alt="" /></p>`)
    .join("");

  return `${descriptionHtml}${galleryHtml}`;
}

function collectBoardStatuses(board: Record<string, unknown>): string[] {
  const raw = [
    ...asArray<Record<string, unknown>>(board.statuses),
    ...asArray<Record<string, unknown>>(board.columns),
    ...asArray<Record<string, unknown>>(board.states),
  ];
  return Array.from(new Set(
    raw
      .map((item) => readString(item.title || item.name || item.status || item.label))
      .filter(Boolean)
  ));
}

function collectBoardColumns(board: Record<string, unknown>): { id: string; title: string }[] {
  const raw = asArray<Record<string, unknown>>(board.columns);
  return raw
    .map((item) => ({
      id: String(item.id ?? item.uid ?? item.column_id ?? ""),
      title: readString(item.title || item.name || item.label),
    }))
    .filter((item) => item.id && item.title);
}

function collectBoardLanes(board: Record<string, unknown>): { id: string; title: string }[] {
  const raw = [
    ...asArray<Record<string, unknown>>(board.lanes),
    ...asArray<Record<string, unknown>>(board.rows),
  ];
  return raw
    .map((item) => ({
      id: String(item.id ?? item.uid ?? item.lane_id ?? ""),
      title: readString(item.title || item.name || item.label),
    }))
    .filter((item) => item.id && item.title);
}

async function rateLimit() {
  const minDelayMs = 220;
  const elapsed = Date.now() - lastKaitenRequestAt;
  if (elapsed < minDelayMs) {
    await sleep(minDelayMs - elapsed);
  }
  lastKaitenRequestAt = Date.now();
}

export class KaitenClient {
  private baseUrl: string;
  private token: string;

  constructor(options: KaitenClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = options.token.trim();
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.baseUrl) throw new KaitenApiError("Kaiten base URL is not configured", 400);
    if (!this.token) throw new KaitenApiError("Kaiten token is not configured", 400);

    await rateLimit();

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    if (!response.ok) {
      let message = `Kaiten request failed with status ${response.status}`;
      try {
        const payload = await response.json() as { message?: string; error?: string };
        message = payload.message || payload.error || message;
      } catch {
        // ignore JSON parse failure
      }
      throw new KaitenApiError(message, response.status);
    }

    return await response.json() as T;
  }

  async testConnection() {
    return await this.getSpaces();
  }

  async getSpaces(): Promise<KaitenSpace[]> {
    const payload = await this.request<unknown>("/spaces");
    const spaces = asArray<Record<string, unknown>>(payload);
    return spaces
      .map((space) => ({
        id: readNumber(space.id) ?? 0,
        title: readString(space.title || space.name),
      }))
      .filter((space) => space.id > 0 && space.title);
  }

  async getBoards(spaceId: number): Promise<KaitenBoardOption[]> {
    const payload = await this.request<unknown>(`/spaces/${spaceId}/boards`);
    const boards = asArray<Record<string, unknown>>(payload);
    return boards
      .map((board) => ({
        id: readNumber(board.id) ?? 0,
        title: readString(board.title || board.name),
        space_id: readNumber(board.space_id ?? board.spaceId),
        statuses: collectBoardStatuses(board),
        columns: collectBoardColumns(board),
        lanes: collectBoardLanes(board),
      }))
      .filter((board) => board.id > 0 && board.title);
  }

  async getCards(boardId: number): Promise<Record<string, unknown>[]> {
    const pageSize = 100;
    const cards: Record<string, unknown>[] = [];
    let offset = 0;

    while (true) {
      const payload = await this.request<unknown>(
        `/cards?board_id=${boardId}&additional_card_fields=description&limit=${pageSize}&offset=${offset}`
      );
      const page = asArray<Record<string, unknown>>(payload);
      cards.push(...page);

      if (page.length < pageSize) {
        break;
      }

      offset += pageSize;
    }

    return cards;
  }

  async getCard(cardId: number): Promise<Record<string, unknown>> {
    return await this.request<Record<string, unknown>>(`/cards/${cardId}`);
  }
}

export function createKaitenClient(options: KaitenClientOptions) {
  return new KaitenClient(options);
}

export function extractCardStatus(card: Record<string, unknown>): string {
  const candidates = [
    card.status,
    card.state,
    card.column_title,
    card.column_name,
    readObject(card.column)?.title,
    readObject(card.column)?.name,
  ];
  return candidates.map((value) => readString(value)).find(Boolean) ?? "";
}

export function extractCardColumnId(card: Record<string, unknown>): number | null {
  return readNumber(card.column_id ?? card.columnId ?? readObject(card.column)?.id);
}

export function extractCardLaneId(card: Record<string, unknown>): number | null {
  return readNumber(card.lane_id ?? card.laneId ?? readObject(card.lane)?.id);
}

export function extractCardTitle(card: Record<string, unknown>): string {
  return readString(card.title || card.name || card.subject);
}

export function extractCardDescription(card: Record<string, unknown>): string {
  const rawDescription = readString(card.description || card.text || card.details);
  const descriptionHtml = normalizeDescriptionMarkup(rawDescription);
  const imageUrls = extractCardImageUrls(card);
  return appendImageGallery(descriptionHtml, imageUrls);
}

export function extractCardDueDate(card: Record<string, unknown>): string | null {
  return readString(card.due_date || card.dueDate || card.deadline || card.finish_date) || null;
}

export function extractCardPriority(card: Record<string, unknown>): string {
  return readString(card.priority || readObject(card.priority_data)?.name).toLowerCase();
}

export function extractCardTags(card: Record<string, unknown>): string[] {
  return asArray<Record<string, unknown>>(card.tags)
    .map((tag) => readString(tag.title || tag.name))
    .filter(Boolean);
}
