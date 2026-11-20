import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class ComposioError extends Error {
    code: string;
    status?: number;
    constructor(code: string, message: string, status?: number) {
      super(message);
      this.name = "ComposioError";
      this.code = code;
      this.status = status;
    }
  }
  return {
    ComposioError,
    authorizeAdminRequest: vi.fn(),
    authorizeCurrentMemberRequest: vi.fn(),
    authorizeCurrentParentRequest: vi.fn(),
    ensureGoogleCollections: vi.fn(),
    createConnectedAccountLink: vi.fn(),
    getConnectedAccount: vi.fn(),
    listConnectedAccounts: vi.fn(),
    deleteConnectedAccount: vi.fn(),
    executeComposioAction: vi.fn(),
    readConnectionSnapshot: vi.fn(),
    writeConnectionSnapshot: vi.fn(),
    reconcileGoogleConnection: vi.fn(),
    disconnectGoogle: vi.fn(),
    syncCalendar: vi.fn(),
    clearCalendarCache: vi.fn(),
    pruneCachedEvents: vi.fn(),
    invalidateGoogleIntegrationOperation: vi.fn(),
  };
});

vi.mock("@/lib/admin-auth", () => ({ authorizeAdminRequest: mocks.authorizeAdminRequest }));
vi.mock("@/lib/server-auth", () => ({
  authorizeCurrentMemberRequest: mocks.authorizeCurrentMemberRequest,
  authorizeCurrentParentRequest: mocks.authorizeCurrentParentRequest,
}));
vi.mock("@/lib/google/pb-collections", () => ({ ensureGoogleCollections: mocks.ensureGoogleCollections }));
vi.mock("@/lib/google/composio", () => ({
  ComposioError: mocks.ComposioError,
  COMPOSIO_TOOLKITS: { CALENDAR: "googlecalendar", TASKS: "googletasks", YOUTUBE: "youtube" },
  COMPOSIO_ACTIONS: {
    YOUTUBE_LIST_USER_PLAYLISTS: "YOUTUBE_LIST_USER_PLAYLISTS",
    YOUTUBE_LIST_PLAYLIST_ITEMS: "YOUTUBE_LIST_PLAYLIST_ITEMS",
    YOUTUBE_CREATE_PLAYLIST: "YOUTUBE_CREATE_PLAYLIST",
    YOUTUBE_ADD_VIDEO_TO_PLAYLIST: "YOUTUBE_ADD_VIDEO_TO_PLAYLIST",
    YOUTUBE_DELETE_PLAYLIST_ITEM: "YOUTUBE_DELETE_PLAYLIST_ITEM",
    YOUTUBE_DELETE_PLAYLIST: "YOUTUBE_DELETE_PLAYLIST",
    YOUTUBE_RATE_VIDEO: "YOUTUBE_RATE_VIDEO",
    YOUTUBE_LIST_RATED_VIDEOS: "YOUTUBE_LIST_RATED_VIDEOS",
    YOUTUBE_LIST_USER_SUBSCRIPTIONS: "YOUTUBE_LIST_USER_SUBSCRIPTIONS",
  },
  createConnectedAccountLink: mocks.createConnectedAccountLink,
  getConnectedAccount: mocks.getConnectedAccount,
  listConnectedAccounts: mocks.listConnectedAccounts,
  deleteConnectedAccount: mocks.deleteConnectedAccount,
  executeComposioAction: mocks.executeComposioAction,
}));
vi.mock("@/lib/google/connection-state", () => ({
  TASKS_SNAPSHOT_KEY: "google_composio_tasks",
  YOUTUBE_SNAPSHOT_KEY: "google_composio_youtube",
  readConnectionSnapshot: mocks.readConnectionSnapshot,
  writeConnectionSnapshot: mocks.writeConnectionSnapshot,
  reconcileGoogleConnection: mocks.reconcileGoogleConnection,
  disconnectGoogle: mocks.disconnectGoogle,
}));
vi.mock("@/lib/google/calendar", () => ({ syncCalendar: mocks.syncCalendar }));
vi.mock("@/lib/google/token-store", () => ({
  clearCalendarCache: mocks.clearCalendarCache,
  pruneCachedEvents: mocks.pruneCachedEvents,
}));
vi.mock("@/lib/google/integration-operation", () => ({
  invalidateGoogleIntegrationOperation: mocks.invalidateGoogleIntegrationOperation,
}));

import {
  addVideoToYouTubePlaylist,
  listYouTubeLikedVideos,
  listYouTubePlaylistItems,
  listYouTubePlaylists,
  mapYouTubePlaylistItemsPayload,
  mapYouTubePlaylistsPayload,
  mapYouTubeRatedVideosPayload,
  mapYouTubeSubscriptionsPayload,
} from "@/lib/google/youtube";
import { POST as setup } from "@/app/api/google/composio/setup/route";
import { GET as status } from "@/app/api/google/composio/status/route";
import { POST as disconnect } from "@/app/api/google/composio/disconnect/route";
import { GET as getState } from "@/app/api/youtube/state/route";
import { GET as getPlaylists, POST as postPlaylists } from "@/app/api/youtube/playlists/route";
import {
  DELETE as deletePlaylistItem,
  GET as getPlaylistItems,
  POST as postPlaylistItem,
} from "@/app/api/youtube/playlists/[id]/items/route";
import { GET as getLikes, POST as postLikes } from "@/app/api/youtube/likes/route";
import { GET as getSubscriptions } from "@/app/api/youtube/subscriptions/route";

const ACTIVE_YT = {
  connectedAccountId: "ca_yt_1",
  status: "ACTIVE",
  accountEmail: "family@example.com",
  connectedAt: "2026-11-20T00:00:00.000Z",
  lastVerifiedAt: "2026-11-20T00:00:00.000Z",
};

const EMPTY = {
  connectedAccountId: null,
  status: null,
  accountEmail: null,
  connectedAt: null,
  lastVerifiedAt: null,
};

function req(method: string, path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
  mocks.authorizeCurrentMemberRequest.mockResolvedValue({
    ok: true,
    member: { id: "m1", role: "child" },
  });
  mocks.authorizeCurrentParentRequest.mockResolvedValue({
    ok: true,
    member: { id: "p1", role: "parent" },
  });
  mocks.ensureGoogleCollections.mockResolvedValue([]);
  mocks.readConnectionSnapshot.mockResolvedValue({ ...ACTIVE_YT });
  mocks.reconcileGoogleConnection.mockResolvedValue({ ...EMPTY });
  mocks.writeConnectionSnapshot.mockResolvedValue(undefined);
  mocks.disconnectGoogle.mockResolvedValue(undefined);
  mocks.deleteConnectedAccount.mockResolvedValue(true);
});

describe("YouTube payload mappers & Composio action schemas", () => {
  it("maps playlists, strips - Topic suffix, skips Deleted/Private rows, and unwraps response_data", () => {
    const playlists = mapYouTubePlaylistsPayload({
      successful: true,
      data: {
        response_data: {
          items: [
            {
              id: "PL123",
              snippet: {
                title: "Sunday Cleaning",
                description: "Family faves",
                thumbnails: { high: { url: "https://i.ytimg.com/high.jpg" } },
              },
              contentDetails: { itemCount: 12 },
              status: { privacyStatus: "private" },
            },
          ],
        },
      },
    });
    expect(playlists).toEqual([
      {
        id: "PL123",
        title: "Sunday Cleaning",
        description: "Family faves",
        itemCount: 12,
        artworkUrl: "https://i.ytimg.com/high.jpg",
        privacyStatus: "private",
      },
    ]);

    const tracks = mapYouTubePlaylistItemsPayload({
      successful: true,
      data: {
        items: [
          {
            id: "PLI_1",
            snippet: {
              title: "Deleted video",
              resourceId: { videoId: "abc12345678" },
            },
          },
          {
            id: "PLI_2",
            snippet: {
              title: "Me Dediqué a Perderte",
              videoOwnerChannelTitle: "Alejandro Fernández - Topic",
              resourceId: { videoId: "SFQRgTgq1vM" },
              thumbnails: { medium: { url: "https://i.ytimg.com/med.jpg" } },
            },
          },
        ],
      },
    });
    expect(tracks).toEqual([
      {
        playlistItemId: "PLI_2",
        videoId: "SFQRgTgq1vM",
        title: "Me Dediqué a Perderte",
        artist: "Alejandro Fernández",
        artworkUrl: "https://i.ytimg.com/med.jpg",
      },
    ]);

    const rated = mapYouTubeRatedVideosPayload({
      successful: true,
      data: {
        items: [
          {
            id: "b393RtiIA18",
            snippet: { title: "Un Millón de Primaveras", channelTitle: "Vicente Fernández - Topic" },
          },
        ],
      },
    });
    expect(rated[0]).toMatchObject({
      videoId: "b393RtiIA18",
      artist: "Vicente Fernández",
    });

    const subs = mapYouTubeSubscriptionsPayload({
      successful: true,
      data: {
        items: [
          {
            snippet: {
              title: "Los Ángeles Azules - Topic",
              resourceId: { channelId: "UCbjHMB9FdaTig0UyrwGNYHA" },
            },
          },
        ],
      },
    });
    expect(subs).toEqual([
      { channelId: "UCbjHMB9FdaTig0UyrwGNYHA", title: "Los Ángeles Azules", artworkUrl: null },
    ]);
  });

  it("calls Composio v3.1 with exact slugs and per-action casing (max_results vs maxResults)", async () => {
    mocks.executeComposioAction.mockResolvedValue({ successful: true, data: { items: [] } });

    await listYouTubePlaylists(25);
    expect(mocks.executeComposioAction).toHaveBeenCalledWith(
      "YOUTUBE_LIST_USER_PLAYLISTS",
      { part: "snippet,contentDetails,status", maxResults: 25 },
      "ca_yt_1",
    );

    await listYouTubeLikedVideos(30);
    expect(mocks.executeComposioAction).toHaveBeenCalledWith(
      "YOUTUBE_LIST_RATED_VIDEOS",
      { rating: "like", part: "snippet,contentDetails", max_results: 30 },
      "ca_yt_1",
    );

    await addVideoToYouTubePlaylist("PL123", "SFQRgTgq1vM");
    expect(mocks.executeComposioAction).toHaveBeenCalledWith(
      "YOUTUBE_ADD_VIDEO_TO_PLAYLIST",
      { playlistId: "PL123", videoId: "SFQRgTgq1vM" },
      "ca_yt_1",
    );

    await listYouTubePlaylistItems("PL123");
    expect(mocks.executeComposioAction).toHaveBeenCalledWith(
      "YOUTUBE_LIST_PLAYLIST_ITEMS",
      { playlistId: "PL123", part: "snippet,contentDetails", maxResults: 50 },
      "ca_yt_1",
    );
  });
});

describe("Composio setup/status/disconnect support for toolkit=youtube", () => {
  it("creates hosted connect link for youtube on google_composio_youtube without touching Calendar", async () => {
    mocks.readConnectionSnapshot.mockResolvedValueOnce({ ...EMPTY });
    mocks.createConnectedAccountLink.mockResolvedValueOnce({
      redirectUrl: "https://backend.composio.dev/link/yt",
      connectedAccountId: "ca_yt_new",
      expiresAt: null,
    });

    const res = await setup(req("POST", "/api/google/composio/setup", { toolkit: "youtube" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, toolkit: "youtube", auth_url: "https://backend.composio.dev/link/yt" });
    expect(mocks.writeConnectionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ connectedAccountId: "ca_yt_new", status: "INITIATED" }),
      "google_composio_youtube",
    );
  });

  it("checks youtube status without triggering syncCalendar", async () => {
    mocks.readConnectionSnapshot.mockResolvedValueOnce({ ...EMPTY, connectedAccountId: "ca_yt_1", status: "INITIATED" });
    mocks.getConnectedAccount.mockResolvedValueOnce({
      id: "ca_yt_1",
      status: "ACTIVE",
      toolkitSlug: "youtube",
      email: "family@example.com",
    });

    const res = await status(req("GET", "/api/google/composio/status?toolkit=youtube"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, connected: true, toolkit: "youtube" });
    expect(mocks.syncCalendar).not.toHaveBeenCalled();
  });

  it("disconnects only youtube snapshot and preserves Calendar cache", async () => {
    const res = await disconnect(req("POST", "/api/google/composio/disconnect", { toolkit: "youtube" }));
    expect(res.status).toBe(200);
    expect(mocks.readConnectionSnapshot).toHaveBeenCalledWith("google_composio_youtube");
    expect(mocks.deleteConnectedAccount).toHaveBeenCalledWith("ca_yt_1");
    expect(mocks.disconnectGoogle).toHaveBeenCalledWith("google_composio_youtube");
    expect(mocks.clearCalendarCache).not.toHaveBeenCalled();
    expect(mocks.invalidateGoogleIntegrationOperation).not.toHaveBeenCalled();
  });
});

describe("/api/youtube/* routes & auth gates", () => {
  it("allows signed-in members to read state/playlists/items/likes/subscriptions, while writes require parent", async () => {
    mocks.executeComposioAction.mockResolvedValue({ successful: true, data: { items: [] } });

    expect((await getState(req("GET", "/api/youtube/state"))).status).toBe(200);
    expect((await getPlaylists(req("GET", "/api/youtube/playlists"))).status).toBe(200);
    expect(
      (
        await getPlaylistItems(req("GET", "/api/youtube/playlists/PL123/items"), {
          params: Promise.resolve({ id: "PL123" }),
        })
      ).status,
    ).toBe(200);
    expect((await getLikes(req("GET", "/api/youtube/likes"))).status).toBe(200);
    expect((await getSubscriptions(req("GET", "/api/youtube/subscriptions"))).status).toBe(200);

    mocks.authorizeCurrentParentRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    expect((await postPlaylists(req("POST", "/api/youtube/playlists", { title: "Kids Mix" }))).status).toBe(403);
    expect(
      (
        await postPlaylistItem(req("POST", "/api/youtube/playlists/PL123/items", { videoId: "SFQRgTgq1vM" }), {
          params: Promise.resolve({ id: "PL123" }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await deletePlaylistItem(req("DELETE", "/api/youtube/playlists/PL123/items?playlistItemId=PLI_1"), {
          params: Promise.resolve({ id: "PL123" }),
        })
      ).status,
    ).toBe(403);
    expect((await postLikes(req("POST", "/api/youtube/likes", { videoId: "SFQRgTgq1vM", rating: "like" }))).status).toBe(
      403,
    );
  });

  it("validates payload inputs and returns 409 when YouTube is not connected", async () => {
    const badTitle = await postPlaylists(req("POST", "/api/youtube/playlists", { title: "   " }));
    expect(badTitle.status).toBe(400);

    const badVid = await postLikes(req("POST", "/api/youtube/likes", { videoId: "bad", rating: "like" }));
    expect(badVid.status).toBe(400);

    mocks.readConnectionSnapshot.mockResolvedValue({ ...EMPTY });
    mocks.reconcileGoogleConnection.mockResolvedValue({ ...EMPTY });
    const notConn = await getPlaylists(req("GET", "/api/youtube/playlists"));
    expect(notConn.status).toBe(409);
  });
});
