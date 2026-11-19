import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authorizeCurrentParentRequest: vi.fn(),
  getHAConfig: vi.fn(),
  haSynthesize: vi.fn(),
  getFullList: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  authorizeCurrentParentRequest: mocks.authorizeCurrentParentRequest,
}));

vi.mock("@/lib/ha/config", () => ({
  getHAConfig: mocks.getHAConfig,
}));

vi.mock("@/lib/ha/voice", () => ({
  haSynthesize: mocks.haSynthesize,
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: async (fn: (pb: any) => Promise<any>) =>
    fn({
      collection: () => ({
        getFullList: mocks.getFullList,
        create: mocks.create,
        update: mocks.update,
      }),
    }),
}));

import {
  announceToSpeakers,
  getSpeakerBroadcastConfig,
  listHASpeakers,
  resetSpeakerConfigCacheForTests,
  resolveLanMediaBaseUrl,
  saveSpeakerBroadcastConfig,
} from "@/lib/ha/speakers";
import { GET as getSpeakersRoute, POST as saveSpeakersRoute } from "@/app/api/ha/speakers/route";
import { POST as testSpeakersRoute } from "@/app/api/ha/speakers/test/route";

describe("ha/speakers", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetSpeakerConfigCacheForTests();
    mocks.getHAConfig.mockResolvedValue({
      haHost: "http://mock-ha:8123",
      haToken: "mock-ha-token",
    });
    mocks.haSynthesize.mockResolvedValue({
      url: "http://mock-ha:8123/api/tts_proxy/synth.mp3",
      path: "/api/tts_proxy/synth.mp3",
    });
    mocks.getFullList.mockResolvedValue([]);
    mocks.create.mockResolvedValue({ id: "rec1" });
    mocks.update.mockResolvedValue({ id: "rec1" });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("resolveLanMediaBaseUrl accepts private IPv4 hosts, rejects mDNS/Tailscale/localhost, and respects CONSUELA_LAN_URL", () => {
    expect(resolveLanMediaBaseUrl("192.168.50.10:3000")).toBe("http://192.168.50.10:3000");
    expect(resolveLanMediaBaseUrl("10.0.1.25:3000")).toBe("http://10.0.1.25:3000");
    expect(resolveLanMediaBaseUrl("172.16.4.2")).toBe("http://172.16.4.2");
    expect(resolveLanMediaBaseUrl("nas.local:3000")).toBeNull();
    expect(resolveLanMediaBaseUrl("host.tailnet.ts.net")).toBeNull();
    expect(resolveLanMediaBaseUrl("localhost:3000")).toBeNull();
    expect(resolveLanMediaBaseUrl("8.8.8.8:3000")).toBeNull();

    vi.stubEnv("CONSUELA_LAN_URL", "http://192.168.50.99:3000/");
    expect(resolveLanMediaBaseUrl("nas.local:3000")).toBe("http://192.168.50.99:3000");
  });

  it("listHASpeakers filters media_player.* entities, flags speaker groups, and sorts groups first then by name", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen" } },
          {
            entity_id: "media_player.kitchen_speaker",
            state: "off",
            attributes: { friendly_name: "Kitchen speaker", device_class: "speaker" },
          },
          {
            entity_id: "media_player.dining_room_speaker",
            state: "idle",
            attributes: { friendly_name: "Dining Room speaker", device_class: "speaker" },
          },
          {
            entity_id: "media_player.downstairs_group",
            state: "off",
            attributes: {
              friendly_name: "Downstairs Group",
              group_members: ["media_player.kitchen_speaker", "media_player.dining_room_speaker"],
            },
          },
        ]),
        { status: 200 }
      )
    );

    const speakers = await listHASpeakers();
    expect(speakers).toEqual([
      {
        entityId: "media_player.downstairs_group",
        name: "Downstairs Group",
        state: "off",
        deviceClass: null,
        isGroup: true,
      },
      {
        entityId: "media_player.dining_room_speaker",
        name: "Dining Room speaker",
        state: "idle",
        deviceClass: "speaker",
        isGroup: false,
      },
      {
        entityId: "media_player.kitchen_speaker",
        name: "Kitchen speaker",
        state: "off",
        deviceClass: "speaker",
        isGroup: false,
      },
    ]);
  });

  it("announceToSpeakers prefers Sarah MP3 over LAN when voiceKey + lanBaseUrl match and sends announce:true", async () => {
    mocks.getFullList.mockResolvedValue([
      {
        id: "cfg1",
        data: {
          enabled: true,
          entities: ["media_player.kitchen_speaker"],
          announceRoutines: true,
        },
      },
    ]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    const result = await announceToSpeakers({
      message: "Dinner is ready!",
      category: "routines",
      voiceKey: "dinner_ready",
      lanBaseUrl: "http://192.168.50.10:3000",
    });

    expect(result).toEqual({
      ok: true,
      attempted: 1,
      delivered: 1,
      failed: 0,
      errors: [],
      mediaUrl: "http://192.168.50.10:3000/sounds/voices/dinner_ready.mp3",
    });
    expect(mocks.haSynthesize).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://mock-ha:8123/api/services/media_player/play_media",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          entity_id: "media_player.kitchen_speaker",
          media_content_id: "http://192.168.50.10:3000/sounds/voices/dinner_ready.mp3",
          media_content_type: "audio/mpeg",
          announce: true,
        }),
      })
    );
  });

  it("announceToSpeakers falls back to Piper TTS when no voiceKey or non-LAN host and respects category & enabled gates", async () => {
    mocks.getFullList.mockResolvedValue([
      {
        id: "cfg1",
        data: {
          enabled: true,
          entities: ["media_player.kitchen_speaker", "media_player.dining_room_speaker"],
          announceChat: true,
          announceWeather: false,
          volume: 0.65,
        },
      },
    ]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    const skippedWeather = await announceToSpeakers({
      message: "Wind advisory",
      category: "weather",
    });
    expect(skippedWeather).toEqual({ ok: false, attempted: 0, delivered: 0, failed: 0, errors: [] });
    expect(fetchMock).not.toHaveBeenCalled();

    const chatRes = await announceToSpeakers({
      message: "Come downstairs",
      category: "chat",
      lanBaseUrl: null,
    });
    expect(chatRes.ok).toBe(true);
    expect(chatRes.delivered).toBe(2);
    expect(chatRes.mediaUrl).toBe("http://mock-ha:8123/api/tts_proxy/synth.mp3");
    expect(mocks.haSynthesize).toHaveBeenCalledWith("Come downstairs");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://mock-ha:8123/api/services/media_player/volume_set",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ entity_id: "media_player.kitchen_speaker", volume_level: 0.65 }),
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://mock-ha:8123/api/services/media_player/play_media",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          entity_id: "media_player.dining_room_speaker",
          media_content_id: "http://mock-ha:8123/api/tts_proxy/synth.mp3",
          media_content_type: "music",
          announce: true,
        }),
      })
    );

    await saveSpeakerBroadcastConfig({ enabled: false });
    const cfg = await getSpeakerBroadcastConfig();
    expect(cfg.enabled).toBe(false);
    const disabledRes = await announceToSpeakers({ message: "Ignored", category: "chat" });
    expect(disabledRes.attempted).toBe(0);
  });

  it("gates GET/POST /api/ha/speakers and POST /api/ha/speakers/test behind authorizeCurrentParentRequest", async () => {
    mocks.authorizeCurrentParentRequest.mockResolvedValue({
      ok: false,
      status: 403,
      error: "adult_only",
    });

    const getRes = await getSpeakersRoute(new NextRequest("http://localhost/api/ha/speakers"));
    expect(getRes.status).toBe(403);

    const postRes = await saveSpeakersRoute(
      new NextRequest("http://localhost/api/ha/speakers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })
    );
    expect(postRes.status).toBe(403);

    const testRes = await testSpeakersRoute(
      new NextRequest("http://localhost/api/ha/speakers/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(testRes.status).toBe(403);

    // Parent path succeeds
    mocks.authorizeCurrentParentRequest.mockResolvedValue({ ok: true, member: { role: "parent" } });
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const okGet = await getSpeakersRoute(new NextRequest("http://localhost/api/ha/speakers"));
    expect(okGet.status).toBe(200);
    const json = await okGet.json();
    expect(json.ok).toBe(true);
    expect(json.config.enabled).toBe(false);
  });
});
