/**
 * YouTube Music — server-only catalog + ad-free audio resolution.
 *
 * ── Why this talks to /youtubei/v1/player directly ─────────────────────
 * `youtubei.js`'s Innertube clients (WEB_REMIX, ANDROID_VR, IOS…) return
 * `streamingData` entries whose audio-only itags carry **neither `url` nor
 * `signatureCipher`**, so `format.decipher()` throws "No valid URL to
 * decipher". YouTube gates those itags behind a proof-of-origin token the Web
 * clients never hand back — minting one via `bgutils-js` works, but it needs a
 * jsdom BotGuard realm and buys nothing extra here.
 *
 * A hand-rolled ANDROID_VR player request *does* return plain `url`s for itags
 * 139/140 (m4a) and 249/251 (webm/opus), so no signature deciphering is needed
 * at all. This mirrors Orchard's `electron/playback/playbackService.js`
 * (`androidVrClient` + `resolveAndroidVrStream`), reimplemented for a Next.js
 * server runtime.
 *
 * Consequences to keep in mind:
 *  - googlevideo answers `HEAD` with 403 but honours `GET` + `Range`, which is
 *    exactly what `<audio>` seeking does.
 *  - URLs are **signed and time-limited** (`expiresInSeconds`, typically ~6h).
 *    Never persist or log them; `/api/media/stream` caches them for minutes.
 *  - The guest identity (visitorData + cookies) is cached in-module and
 *    refreshed when the player endpoint starts rejecting us.
 *  - This is an unofficial API and can break without warning.
 *
 * Everything here must stay on the server: the browser must never see the
 * guest cookie, and must never see the signed URL.
 */

import { ClientType, Innertube } from "youtubei.js";

const YOUTUBE_ORIGIN = "https://www.youtube.com";
const WEB_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** The Android VR client profile that still yields direct audio URLs. */
const ANDROID_VR_CLIENT = {
  clientName: "ANDROID_VR",
  clientVersion: "1.65.10",
  deviceMake: "Oculus",
  deviceModel: "Quest 3",
  androidSdkVersion: 32,
  userAgent:
    "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  osName: "Android",
  osVersion: "12L",
  hl: "en",
  timeZone: "UTC",
  utcOffsetMinutes: 0,
} as const;

/** `signatureTimestamp` the ANDROID_VR client expects in playbackContext. */
const SIGNATURE_TIMESTAMP = 20563;

/** Keep well inside the signed-URL lifetime so a queued track never 403s. */
const STREAM_CACHE_TTL_MS = 4 * 60 * 1000;

/** A guest identity only needs refreshing this often. */
const GUEST_IDENTITY_TTL_MS = 30 * 60 * 1000;

export interface MediaTrack {
  /** YouTube video id. */
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Seconds, or null when YouTube reports no duration (live streams). */
  durationSeconds: number | null;
  artworkUrl: string | null;
  source: "youtube_music";
}

export interface ResolvedStream {
  /** Short-lived signed URL. Never log this — it is a bearer credential. */
  url: string;
  mimeType: string;
  /** Bytes, when YouTube reports it. */
  contentLength: number | null;
  durationSeconds: number | null;
  /** Epoch ms after which the signed URL is no longer valid. */
  expiresAt: number;
}


// ── Guest identity ────────────────────────────────────────────────────────

interface GuestIdentity {
  visitorData: string;
  cookie: string;
  fetchedAt: number;
}

let guestIdentity: GuestIdentity | null = null;
let guestIdentityPending: Promise<GuestIdentity> | null = null;

function responseCookies(headers: Headers): string[] {
  const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  return raw.map((entry) => entry.split(";")[0] ?? "").filter(Boolean);
}

/**
 * A guest visitorData + cookie pair, taken from a watch page.
 * Cached for 30 minutes; `invalidateGuestIdentity()` forces a refresh when the
 * player endpoint starts rejecting our identity.
 */
async function currentGuestIdentity(): Promise<GuestIdentity> {
  if (guestIdentity && Date.now() - guestIdentity.fetchedAt < GUEST_IDENTITY_TTL_MS) {
    return guestIdentity;
  }
  if (guestIdentityPending) return guestIdentityPending;

  const pending = (async (): Promise<GuestIdentity> => {
    const response = await fetch(
      `${YOUTUBE_ORIGIN}/watch?v=jfKfPfyJRdk&bpctr=9999999999&has_verified=1`,
      {
        headers: { "User-Agent": WEB_USER_AGENT, Cookie: "CONSENT=YES+cb" },
        cache: "no-store",
      },
    );
    const html = await response.text();
    const visitorData = /"visitorData":"([^"]+)/.exec(html)?.[1];
    if (!response.ok || !visitorData) {
      throw new Error("YouTube did not issue a guest visitor identity");
    }
    const identity: GuestIdentity = {
      visitorData,
      cookie: [...responseCookies(response.headers), "CONSENT=YES+cb"].join("; "),
      fetchedAt: Date.now(),
    };
    guestIdentity = identity;
    return identity;
  })().finally(() => {
    if (guestIdentityPending === pending) guestIdentityPending = null;
  });

  guestIdentityPending = pending;
  return pending;
}

/** Drop the cached guest identity (called when the player endpoint 4xx's). */
export function invalidateGuestIdentity(): void {
  guestIdentity = null;
  guestIdentityPending = null;
}

// ── Catalog (search) ──────────────────────────────────────────────────────

/** One shared Innertube for catalog reads; music search needs no identity. */
let catalogPromise: Promise<Innertube> | null = null;

function catalog(): Promise<Innertube> {
  catalogPromise ??= Innertube.create({ client_type: ClientType.MUSIC });
  return catalogPromise;
}

interface RawMusicItem {
  id?: string;
  title?: string;
  duration?: { seconds?: number };
  artists?: Array<{ name?: string }>;
  album?: { name?: string };
  thumbnails?: Array<{ url: string; width?: number }>;
}

/** Prefer the largest thumbnail offered; the browser scales it down. */
function artworkUrlFor(thumbnails: Array<{ url: string; width?: number }>): string | null {
  if (!thumbnails.length) return null;
  const best = [...thumbnails].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  return best?.url ?? null;
}

function toTrack(item: RawMusicItem): MediaTrack | null {
  if (!item?.id || !item.title) return null;
  return {
    id: item.id,
    title: item.title,
    artist: item.artists?.map((a) => a.name).filter(Boolean).join(" & ") || "Unknown artist",
    album: item.album?.name ?? "",
    durationSeconds: typeof item.duration?.seconds === "number" ? item.duration.seconds : null,
    artworkUrl: artworkUrlFor(item.thumbnails ?? []),
    source: "youtube_music",
  };
}

/**
 * Search YouTube Music for songs. An empty query returns [] rather than
 * throwing — the widget treats "no results" and "search failed" the same way.
 */
export async function searchTracks(query: string, limit = 20): Promise<MediaTrack[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const yt = await catalog();
  const results = await yt.music.search(trimmed, { type: "song" });
  const items = (results.songs?.contents ?? []) as RawMusicItem[];
  return items
    .map(toTrack)
    .filter((track): track is MediaTrack => track !== null)
    .slice(0, limit);
}

// ── Stream resolution ─────────────────────────────────────────────────────

interface RawFormat {
  itag?: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  contentLength?: string | number;
  approxDurationMs?: number;
}

/** itag → container, for the audio-only formats the VR client returns. */
const AUDIO_ITAGS: Record<number, string> = {
  139: "m4a",
  140: "m4a",
  249: "webm",
  251: "webm",
};

/**
 * Preference order. Opus/webm sounds better per bitrate, but iOS Safari cannot
 * decode webm/opus in an <audio> element — m4a stays first as the safe default
 * and webm remains available as the higher-quality alternative.
 */
const ITAG_PREFERENCE = [140, 251, 139, 249];

interface PlayerStreamingData {
  expiresInSeconds?: number;
  formats?: RawFormat[];
  adaptiveFormats?: RawFormat[];
}

interface StreamCacheEntry {
  stream: ResolvedStream;
  cachedAt: number;
}

const streamCache = new Map<string, StreamCacheEntry>();

async function requestPlayer(videoId: string): Promise<Record<string, unknown>> {
  const identity = await currentGuestIdentity();
  const response = await fetch(`${YOUTUBE_ORIGIN}/youtubei/v1/player?prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": ANDROID_VR_CLIENT.userAgent,
      "X-Youtube-Client-Name": "28",
      "X-Youtube-Client-Version": ANDROID_VR_CLIENT.clientVersion,
      "X-Goog-Visitor-Id": identity.visitorData,
      Origin: YOUTUBE_ORIGIN,
      Cookie: identity.cookie,
    },
    body: JSON.stringify({
      context: { client: { ...ANDROID_VR_CLIENT, visitorData: identity.visitorData } },
      videoId,
      playbackContext: {
        contentPlaybackContext: {
          html5Preference: "HTML5_PREF_WANTS",
          signatureTimestamp: SIGNATURE_TIMESTAMP,
        },
      },
      contentCheckOk: true,
      racyCheckOk: true,
    }),
    cache: "no-store",
  });

  const text = await response.text();
  let data: Record<string, unknown>;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("YouTube returned an unparseable player response");
  }

  if (!response.ok) {
    invalidateGuestIdentity();
    throw new Error(`YouTube player request failed with HTTP ${response.status}`);
  }
  return data;
}

/** First playable audio-only format in preference order, else highest bitrate. */
export function pickAudioFormat(formats: RawFormat[]): RawFormat | null {
  const audio = formats.filter(
    (f) => (f.mimeType ?? "").startsWith("audio/") && typeof f.url === "string",
  );
  for (const itag of ITAG_PREFERENCE) {
    const match = audio.find((f) => f.itag === itag);
    if (match) return match;
  }
  return audio.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0] ?? null;
}

/**
 * Resolve a playable, signed audio URL for a YouTube video id.
 *
 * Cached briefly (STREAM_CACHE_TTL_MS) so the widget and the full player page
 * hitting the same track don't each mint a separate URL.
 */
export async function resolveStream(videoId: string): Promise<ResolvedStream> {
  const id = videoId.trim();
  if (!id) throw new Error("A video id is required to resolve a stream");

  const cached = streamCache.get(id);
  if (cached && Date.now() - cached.cachedAt < STREAM_CACHE_TTL_MS) return cached.stream;

  const data = await requestPlayer(id);
  const playability = data.playabilityStatus as { status?: string; reason?: string } | undefined;
  if (playability?.status && playability.status !== "OK") {
    throw new Error(playability.reason || `YouTube playback is ${playability.status}`);
  }

  const streaming = data.streamingData as PlayerStreamingData | undefined;
  const formats = [...(streaming?.formats ?? []), ...(streaming?.adaptiveFormats ?? [])];
  const chosen = pickAudioFormat(formats);
  if (!chosen?.url) {
    throw new Error("YouTube returned no playable audio format for this track");
  }

  const expiresInSeconds = streaming?.expiresInSeconds ?? 21_600;
  const rawLength = chosen.contentLength;
  const stream: ResolvedStream = {
    url: chosen.url,
    mimeType: (chosen.mimeType ?? "audio/mp4").split(";")[0]?.trim() || "audio/mp4",
    contentLength:
      typeof rawLength === "number" ? rawLength : rawLength ? Number(rawLength) || null : null,
    durationSeconds: chosen.approxDurationMs ? Math.round(chosen.approxDurationMs / 1000) : null,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };

  streamCache.set(id, { stream, cachedAt: Date.now() });
  return stream;
}

/** Container name for a resolved itag ("m4a" | "webm"), used for the MIME hint. */
export function audioContainerFor(itag: number | null): string | null {
  if (itag === null) return null;
  return AUDIO_ITAGS[itag] ?? null;
}

/** Clear cached streams — used by tests and after a forced re-resolve. */
export function clearStreamCache(): void {
  streamCache.clear();
}

export const __testing = {
  STREAM_CACHE_TTL_MS,
  GUEST_IDENTITY_TTL_MS,
  ITAG_PREFERENCE,
  WEB_USER_AGENT,
};
