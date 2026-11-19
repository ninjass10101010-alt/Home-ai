import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  publishBroadcast,
  waitForBroadcast,
  getRecentBroadcasts,
  resetBroadcastForTests,
} from "@/lib/broadcast";

vi.mock("@/lib/ha/voice", () => ({
  haSynthesize: vi.fn(async (text: string) => ({
    url: `http://mock-ha:8123/api/tts_proxy/mock-${encodeURIComponent(text.slice(0, 10))}.mp3`,
    path: "/api/tts_proxy/mock.mp3",
  })),
}));

const { announceToSpeakersMock } = vi.hoisted(() => ({
  announceToSpeakersMock: vi.fn(async () => ({
    ok: true,
    attempted: 1,
    delivered: 1,
    failed: 0,
    errors: [],
  })),
}));

vi.mock("@/lib/ha/speakers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ha/speakers")>();
  return {
    ...actual,
    announceToSpeakers: announceToSpeakersMock,
  };
});

describe("broadcast subsystem", () => {
  beforeEach(() => {
    resetBroadcastForTests();
    vi.clearAllMocks();
  });

  it("publishes a broadcast with TTS audio url and stores it", async () => {
    const item = await publishBroadcast("Dinner is ready!", {
      title: "Dinner Time 🍽️",
      sender: "Dad",
    });

    expect(item.id).toMatch(/^bc-\d+-[a-z0-9]+$/);
    expect(item.message).toBe("Dinner is ready!");
    expect(item.title).toBe("Dinner Time 🍽️");
    expect(item.sender).toBe("Dad");
    expect(item.audioUrl).toContain("Dinner%20is");

    const recent = getRecentBroadcasts();
    expect(recent.length).toBe(0); // sinceId omitted returns empty to prevent startup replay

    const sinceOld = getRecentBroadcasts("old-id");
    expect(sinceOld.length).toBe(0); // unknown id returns empty

    const sinceCurrent = getRecentBroadcasts(item.id);
    expect(sinceCurrent.length).toBe(0); // nothing after current
  });

  it("retrieves broadcasts newer than sinceId", async () => {
    const first = await publishBroadcast("Message 1");
    const second = await publishBroadcast("Message 2");

    const newer = getRecentBroadcasts(first.id);
    expect(newer.length).toBe(1);
    expect(newer[0].id).toBe(second.id);
    expect(newer[0].message).toBe("Message 2");
  });

  it("throws when publishing empty message", async () => {
    await expect(publishBroadcast("   ")).rejects.toThrow("Cannot broadcast empty message");
  });

  it("waitForBroadcast resolves immediately when pending items exist", async () => {
    const first = await publishBroadcast("First");
    const second = await publishBroadcast("Second");

    const items = await waitForBroadcast(first.id, 500);
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(second.id);
  });

  it("waitForBroadcast waits and resolves when a new broadcast is published", async () => {
    const waitPromise = waitForBroadcast("now", 2000);

    // Publish after 50ms
    setTimeout(() => {
      void publishBroadcast("Breaking News");
    }, 50);

    const items = await waitPromise;
    expect(items.length).toBe(1);
    expect(items[0].message).toBe("Breaking News");
  });

  it("waitForBroadcast times out with empty array when no broadcast arrives", async () => {
    const items = await waitForBroadcast("now", 50);
    expect(items).toEqual([]);
  });

  it("skipTablet: true forwards to Google speakers without enqueueing broadcastHistory", async () => {
    const first = await publishBroadcast("Baseline");
    const skipped = await publishBroadcast("Take Dogs Out!", {
      title: "Routine Starting",
      category: "routines",
      voiceKey: "routine_dogs",
      skipTablet: true,
    });

    expect(skipped.speakers?.delivered).toBe(1);
    expect(announceToSpeakersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Take Dogs Out!",
        category: "routines",
        voiceKey: "routine_dogs",
      })
    );
    expect(getRecentBroadcasts(first.id)).toEqual([]);
  });
});
