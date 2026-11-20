import { ComposioError, COMPOSIO_ACTIONS, COMPOSIO_TOOLKITS, executeComposioAction } from "./composio";
import {
  readConnectionSnapshot,
  reconcileGoogleConnection,
  YOUTUBE_SNAPSHOT_KEY,
} from "./connection-state";

export interface YouTubeConnectionStatus {
  connected: boolean;
  pending: boolean;
  status: string | null;
  accountEmail: string | null;
}

export interface YouTubePlaylistSummary {
  id: string;
  title: string;
  description: string;
  itemCount: number;
  artworkUrl: string | null;
  privacyStatus: string | null;
}

export interface YouTubePlaylistTrack {
  playlistItemId: string;
  videoId: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
}

export interface YouTubeSubscriptionSummary {
  channelId: string;
  title: string;
  artworkUrl: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unwrapExecuteResult(payload: unknown): unknown {
  const record = asRecord(payload);
  if (record && record.successful === false) {
    const error = asRecord(record.error);
    const message =
      typeof error?.message === "string" && error.message
        ? error.message
        : typeof record.error === "string" && record.error
          ? record.error
          : "Composio YouTube action failed";
    throw new ComposioError("api_error", message);
  }
  if (record && "data" in record) return record.data;
  return payload;
}

function collectItems(root: unknown, keys: string[]): unknown[] {
  if (Array.isArray(root)) return root;
  const record = asRecord(root);
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return [value];
  }
  const nested = asRecord(record.response_data);
  if (nested) return collectItems(nested, keys);
  if (typeof record.id === "string" && record.id.length > 0) return [record];
  return [];
}

function bestThumbnail(thumbnailsValue: unknown): string | null {
  const thumbs = asRecord(thumbnailsValue);
  if (!thumbs) return null;
  for (const key of ["maxres", "standard", "high", "medium", "default"]) {
    const entry = asRecord(thumbs[key]);
    const url = asString(entry?.url);
    if (url) return url;
  }
  return null;
}

function stripTopicSuffix(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.endsWith(" - Topic") ? trimmed.slice(0, -" - Topic".length).trim() : trimmed;
}

function extractVideoId(record: Record<string, unknown>): string {
  const snippet = asRecord(record.snippet);
  const contentDetails = asRecord(record.contentDetails);
  const resourceId = asRecord(snippet?.resourceId);
  const idObj = asRecord(record.id);
  const candidate =
    asString(contentDetails?.videoId) ||
    asString(resourceId?.videoId) ||
    asString(idObj?.videoId) ||
    asString(record.videoId) ||
    asString(record.id);
  return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : "";
}

export function mapYouTubePlaylistsPayload(payload: unknown): YouTubePlaylistSummary[] {
  const items = collectItems(unwrapExecuteResult(payload), ["items", "playlists", "playlist"]);
  const out: YouTubePlaylistSummary[] = [];
  for (const raw of items) {
    const record = asRecord(raw);
    if (!record) continue;
    const id = asString(record.id);
    if (!id) continue;
    const snippet = asRecord(record.snippet);
    const contentDetails = asRecord(record.contentDetails);
    const status = asRecord(record.status);
    const title = asString(snippet?.title) || asString(record.title);
    if (!title) continue;
    const itemCount =
      typeof contentDetails?.itemCount === "number" && Number.isFinite(contentDetails.itemCount)
        ? contentDetails.itemCount
        : 0;
    out.push({
      id,
      title,
      description: asString(snippet?.description),
      itemCount,
      artworkUrl: bestThumbnail(snippet?.thumbnails),
      privacyStatus: asString(status?.privacyStatus) || null,
    });
  }
  return out;
}

export function mapYouTubePlaylistItemsPayload(payload: unknown): YouTubePlaylistTrack[] {
  const items = collectItems(unwrapExecuteResult(payload), ["items", "playlistItems", "videos"]);
  const out: YouTubePlaylistTrack[] = [];
  for (const raw of items) {
    const record = asRecord(raw);
    if (!record) continue;
    const snippet = asRecord(record.snippet);
    const title = asString(snippet?.title) || asString(record.title);
    if (!title || title === "Deleted video" || title === "Private video") continue;
    const videoId = extractVideoId(record);
    if (!videoId) continue;
    const playlistItemId = asString(record.id) || videoId;
    const rawArtist =
      asString(snippet?.videoOwnerChannelTitle) ||
      asString(snippet?.channelTitle) ||
      asString(record.channelTitle);
    out.push({
      playlistItemId,
      videoId,
      title,
      artist: stripTopicSuffix(rawArtist),
      artworkUrl: bestThumbnail(snippet?.thumbnails),
    });
  }
  return out;
}

export function mapYouTubeRatedVideosPayload(payload: unknown): YouTubePlaylistTrack[] {
  const items = collectItems(unwrapExecuteResult(payload), ["items", "videos"]);
  const out: YouTubePlaylistTrack[] = [];
  for (const raw of items) {
    const record = asRecord(raw);
    if (!record) continue;
    const snippet = asRecord(record.snippet);
    const title = asString(snippet?.title) || asString(record.title);
    if (!title || title === "Deleted video" || title === "Private video") continue;
    const videoId = extractVideoId(record);
    if (!videoId) continue;
    const rawArtist = asString(snippet?.channelTitle) || asString(record.channelTitle);
    out.push({
      playlistItemId: videoId,
      videoId,
      title,
      artist: stripTopicSuffix(rawArtist),
      artworkUrl: bestThumbnail(snippet?.thumbnails),
    });
  }
  return out;
}

export function mapYouTubeSubscriptionsPayload(payload: unknown): YouTubeSubscriptionSummary[] {
  const items = collectItems(unwrapExecuteResult(payload), ["items", "subscriptions"]);
  const out: YouTubeSubscriptionSummary[] = [];
  for (const raw of items) {
    const record = asRecord(raw);
    if (!record) continue;
    const snippet = asRecord(record.snippet);
    const resourceId = asRecord(snippet?.resourceId);
    const channelId = asString(resourceId?.channelId) || asString(record.channelId) || asString(record.id);
    const title = stripTopicSuffix(asString(snippet?.title) || asString(record.title));
    if (!channelId || !title) continue;
    out.push({
      channelId,
      title,
      artworkUrl: bestThumbnail(snippet?.thumbnails),
    });
  }
  return out;
}

export async function getYouTubeConnectionStatus(): Promise<YouTubeConnectionStatus> {
  let snapshot = await readConnectionSnapshot(YOUTUBE_SNAPSHOT_KEY);
  if (!snapshot.connectedAccountId || snapshot.status !== "ACTIVE") {
    try {
      snapshot = await reconcileGoogleConnection(YOUTUBE_SNAPSHOT_KEY, COMPOSIO_TOOLKITS.YOUTUBE);
    } catch {
      // Transient broker hiccup must preserve whatever local state was already read.
    }
  }
  const connected = !!snapshot.connectedAccountId && snapshot.status === "ACTIVE";
  const pending =
    !connected && (snapshot.status === "INITIALIZING" || snapshot.status === "INITIATED");
  return {
    connected,
    pending,
    status: snapshot.status ?? null,
    accountEmail: snapshot.accountEmail ?? null,
  };
}

export async function requireYouTubeAccountId(): Promise<string> {
  let snapshot = await readConnectionSnapshot(YOUTUBE_SNAPSHOT_KEY);
  if (!snapshot.connectedAccountId || snapshot.status !== "ACTIVE") {
    snapshot = await reconcileGoogleConnection(YOUTUBE_SNAPSHOT_KEY, COMPOSIO_TOOLKITS.YOUTUBE);
  }
  if (!snapshot.connectedAccountId || snapshot.status !== "ACTIVE") {
    throw new ComposioError("not_connected", "YouTube account is not connected");
  }
  return snapshot.connectedAccountId;
}

export async function listYouTubePlaylists(maxResults = 50): Promise<YouTubePlaylistSummary[]> {
  const accountId = await requireYouTubeAccountId();
  const res = await executeComposioAction<unknown>(
    COMPOSIO_ACTIONS.YOUTUBE_LIST_USER_PLAYLISTS,
    { part: "snippet,contentDetails,status", maxResults },
    accountId,
  );
  return mapYouTubePlaylistsPayload(res);
}

export async function listYouTubePlaylistItems(
  playlistId: string,
  maxResults = 50,
): Promise<YouTubePlaylistTrack[]> {
  const accountId = await requireYouTubeAccountId();
  const res = await executeComposioAction<unknown>(
    COMPOSIO_ACTIONS.YOUTUBE_LIST_PLAYLIST_ITEMS,
    { playlistId, part: "snippet,contentDetails", maxResults },
    accountId,
  );
  return mapYouTubePlaylistItemsPayload(res);
}

export async function createYouTubePlaylist(args: {
  title: string;
  description?: string;
  privacyStatus?: "private" | "unlisted" | "public";
}): Promise<YouTubePlaylistSummary> {
  const accountId = await requireYouTubeAccountId();
  const res = await executeComposioAction<unknown>(
    COMPOSIO_ACTIONS.YOUTUBE_CREATE_PLAYLIST,
    {
      title: args.title.trim(),
      description: args.description?.trim() ?? "",
      privacyStatus: args.privacyStatus ?? "private",
    },
    accountId,
  );
  const created = mapYouTubePlaylistsPayload(res)[0];
  if (created) return created;
  const unwrapped = asRecord(unwrapExecuteResult(res));
  const nested = asRecord(unwrapped?.response_data) ?? unwrapped;
  const id = asString(nested?.id);
  if (!id) throw new ComposioError("api_error", "Composio did not return the created playlist");
  return {
    id,
    title: args.title.trim(),
    description: args.description?.trim() ?? "",
    itemCount: 0,
    artworkUrl: null,
    privacyStatus: args.privacyStatus ?? "private",
  };
}

export async function addVideoToYouTubePlaylist(
  playlistId: string,
  videoId: string,
): Promise<{ playlistItemId: string; playlistId: string; videoId: string }> {
  const accountId = await requireYouTubeAccountId();
  const res = await executeComposioAction<unknown>(
    COMPOSIO_ACTIONS.YOUTUBE_ADD_VIDEO_TO_PLAYLIST,
    { playlistId, videoId },
    accountId,
  );
  const unwrapped = asRecord(unwrapExecuteResult(res));
  const nested = asRecord(unwrapped?.response_data) ?? unwrapped;
  const playlistItemId = asString(nested?.id) || videoId;
  return { playlistItemId, playlistId, videoId };
}

export async function removeYouTubePlaylistItem(playlistItemId: string): Promise<void> {
  const accountId = await requireYouTubeAccountId();
  const res = await executeComposioAction<unknown>(
    COMPOSIO_ACTIONS.YOUTUBE_DELETE_PLAYLIST_ITEM,
    { id: playlistItemId },
    accountId,
  );
  unwrapExecuteResult(res);
}

export async function listYouTubeLikedVideos(maxResults = 50): Promise<YouTubePlaylistTrack[]> {
  const accountId = await requireYouTubeAccountId();
  const res = await executeComposioAction<unknown>(
    COMPOSIO_ACTIONS.YOUTUBE_LIST_RATED_VIDEOS,
    { rating: "like", part: "snippet,contentDetails", max_results: maxResults },
    accountId,
  );
  return mapYouTubeRatedVideosPayload(res);
}

export async function rateYouTubeVideo(
  videoId: string,
  rating: "like" | "dislike" | "none",
): Promise<void> {
  const accountId = await requireYouTubeAccountId();
  const res = await executeComposioAction<unknown>(
    COMPOSIO_ACTIONS.YOUTUBE_RATE_VIDEO,
    { id: videoId, rating },
    accountId,
  );
  unwrapExecuteResult(res);
}

export async function listYouTubeSubscriptions(
  maxResults = 50,
): Promise<YouTubeSubscriptionSummary[]> {
  const accountId = await requireYouTubeAccountId();
  const res = await executeComposioAction<unknown>(
    COMPOSIO_ACTIONS.YOUTUBE_LIST_USER_SUBSCRIPTIONS,
    { part: "snippet", maxResults },
    accountId,
  );
  return mapYouTubeSubscriptionsPayload(res);
}

export function composioHttpStatus(error: ComposioError): number {
  switch (error.code) {
    case "not_configured":
      return 503;
    case "not_connected":
      return 409;
    case "auth_failed":
      return 401;
    default:
      return 502;
  }
}
