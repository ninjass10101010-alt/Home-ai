import { describe, it, expect, vi, afterEach } from "vitest";
import { eventCountdown, stripForSpeech } from "@/lib/consuela/chat-context";
import {
  speak,
  stopSpeaking,
  isSpeechSupported,
  lastSpokenRef,
} from "@/lib/consuela/speech";

describe("eventCountdown", () => {
  const sixPM = new Date("2026-09-02T18:00:00");

  it("counts down in minutes inside 90 minutes", () => {
    expect(eventCountdown("6:45 PM", sixPM)).toBe("in 45m");
    expect(eventCountdown("6:01 PM", sixPM)).toBe("in 1m");
  });

  it("counts down in hours+minutes between 60 and 90 minutes", () => {
    expect(eventCountdown("7:20 PM", sixPM)).toBe("in 1h 20m");
  });

  it("shows the clock time beyond 90 minutes", () => {
    expect(eventCountdown("8:45 PM", sixPM)).toBe("at 8:45 PM");
  });

  it("returns null for past and unparseable times", () => {
    expect(eventCountdown("5:00 PM", sixPM)).toBeNull();
    expect(eventCountdown("whenever", sixPM)).toBeNull();
  });

  it("parses 24-hour input too", () => {
    expect(eventCountdown("18:30", sixPM)).toBe("in 30m");
  });
});

describe("stripForSpeech", () => {
  it("removes markdown, list markers, and emoji noise for the voice", () => {
    const raw = "Here's the plan:\n- **Milk** 🥛\n- Bread\n\n✅ Added 2 items to grocery";
    const out = stripForSpeech(raw);
    expect(out).toContain("Milk");
    expect(out).not.toContain("**");
    expect(out).toMatch(/^- Milk/m);
    expect(out).not.toContain("🥛");
  });
});

describe("speech", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    lastSpokenRef.current = null;
  });

  const stubSpeech = (opts: { supported?: boolean; speaking?: boolean } = {}) => {
    const fake = {
      speaking: opts.speaking ?? false,
      cancel: vi.fn(),
      speak: vi.fn(),
    };
    if (opts.supported === false) {
      // The support check is functional (typeof synth?.speak === "function"),
      // so stubbing undefined is enough to read as unsupported.
      vi.stubGlobal("speechSynthesis", undefined);
    } else {
      // jsdom has no SpeechSynthesisUtterance — real browsers do.
      vi.stubGlobal("SpeechSynthesisUtterance", class {
        text: string;
        rate?: number;
        lang?: string;
        constructor(text: string) { this.text = text; }
      });
      vi.stubGlobal("speechSynthesis", fake);
    }
    return fake;
  };

  it("reports support honestly", () => {
    stubSpeech();
    expect(isSpeechSupported()).toBe(true);
    stubSpeech({ supported: false });
    expect(isSpeechSupported()).toBe(false);
  });

  it("speak() reads cleaned text and records it; stopSpeaking() cancels", () => {
    const fake = stubSpeech();
    speak("Hello family");
    expect(fake.speak).toHaveBeenCalledTimes(1);
    expect(lastSpokenRef.current).toBe("Hello family");
    stopSpeaking();
    // speak() cancels any in-flight voice before starting (never overlap),
    // stopSpeaking() cancels again — 2 total.
    expect(fake.cancel).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when unsupported or given empty text", () => {
    stubSpeech({ supported: false });
    expect(() => speak("hi")).not.toThrow();
    stubSpeech();
    const fake = (globalThis as any).speechSynthesis;
    speak("   ");
    expect(fake.speak).not.toHaveBeenCalled();
  });
});
