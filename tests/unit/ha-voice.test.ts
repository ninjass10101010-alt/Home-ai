import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanTextForTTS, haSynthesize, haTranscribe } from "@/lib/ha/voice";

vi.mock("@/lib/ha/config", () => ({
  getHAConfig: vi.fn(async () => ({
    haHost: "http://mock-ha:8123",
    haToken: "mock-token",
  })),
}));

describe("cleanTextForTTS", () => {
  it("cleans markdown and emojis cleanly", () => {
    const raw = "✨ **Hello** family! Here is `code` and [a link](http://foo.com). How are you? 😊";
    const cleaned = cleanTextForTTS(raw);
    expect(cleaned).toBe("Hello family! Here is code and a link. How are you?");
  });

  it("handles empty or whitespace strings", () => {
    expect(cleanTextForTTS("")).toBe("");
    expect(cleanTextForTTS("   ")).toBe("");
  });

  it("truncates very long responses cleanly at sentence boundaries", () => {
    const long = "First sentence here. " + "This is a repeating sentence to make the output very long. ".repeat(10);
    const cleaned = cleanTextForTTS(long);
    expect(cleaned.length).toBeLessThan(450);
    expect(cleaned.endsWith(".") || cleaned.endsWith("…")).toBe(true);
  });
});

describe("haSynthesize", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls HA /api/tts_get_url and returns the full proxy URL", async () => {
    const mockFetch = vi.fn(async (_url: string, _init: any) => ({
      ok: true,
      json: async () => ({
        url: "http://mock-ha:8123/api/tts_proxy/sample.mp3",
        path: "/api/tts_proxy/sample.mp3",
      }),
    }));
    global.fetch = mockFetch as any;

    const result = await haSynthesize("Hello family");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://mock-ha:8123/api/tts_get_url",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer mock-token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          platform: "tts.piper",
          message: "Hello family",
        }),
      })
    );
    expect(result.url).toBe("http://mock-ha:8123/api/tts_proxy/sample.mp3");
    expect(result.path).toBe("/api/tts_proxy/sample.mp3");
  });

  it("throws an error if text contains no speakable characters", async () => {
    await expect(haSynthesize("   ")).rejects.toThrow("No speakable text provided");
  });
});

describe("haTranscribe", () => {
  it("sends WAV buffer directly with required X-Speech-Content header", async () => {
    // 44-byte dummy WAV header
    const wavBuffer = Buffer.alloc(44);
    wavBuffer.write("RIFF", 0);
    wavBuffer.write("WAVE", 8);

    const mockFetch = vi.fn(async (_url: string, _init: any) => ({
      ok: true,
      json: async () => ({
        text: "turn on living room light",
        result: "success",
      }),
    }));
    global.fetch = mockFetch as any;

    const result = await haTranscribe(wavBuffer);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://mock-ha:8123/api/stt/stt.faster_whisper",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer mock-token",
          "X-Speech-Content": "format=wav; codec=pcm; sample_rate=16000; bit_rate=16; channel=1; language=en",
        }),
      })
    );
    expect(result.text).toBe("turn on living room light");
  });
});
